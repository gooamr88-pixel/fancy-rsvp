import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

/**
 * API base URL comes from local.properties (untracked) so a developer's laptop
 * and a release build never accidentally share one, and so no hostname is baked
 * into version control.
 */
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun prop(key: String, fallback: String): String =
    (localProps.getProperty(key) ?: System.getenv(key) ?: fallback)

android {
    namespace = "com.fancyrsvp.checkin"
    compileSdk = 35

    /**
     * The kiosk scanner SDK ships as a plain JAR plus a native library, not as a
     * Maven artifact, so both live in `app/libs/` and are wired up by hand.
     *
     * `libts_serial_port.so` is what actually opens the serial device — the JAR
     * is only a thin JNI wrapper over it. Four ABIs are shipped; the vendor also
     * supplies mips/mips64/armeabi, which the current NDK no longer supports and
     * which no device made this decade uses.
     *
     * If the .so for the running device's ABI is missing, `System.loadLibrary`
     * throws at class-init time inside the vendor code. HardwareScanSource
     * treats that as "no scanner attached" rather than letting it escape — see
     * the note there.
     */
    sourceSets {
        getByName("main") {
            jniLibs.srcDirs("libs")
        }
    }

    defaultConfig {
        applicationId = "com.fancyrsvp.checkin"
        // API 26 covers effectively every tablet in the market (spec §4).
        minSdk = 26
        targetSdk = 35
        // Bump both on every build you put on a device. versionCode is what
        // Android uses to decide an upgrade is an upgrade; versionName is what
        // the crash report prints, and without it a bug report cannot say which
        // build actually failed.
        versionCode = 15
        versionName = "1.6.1"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Locales the staff UI ships in. English only, by the owner's decision —
        // §9.9's ar and fr are descoped and there is no values-ar/ or values-fr/
        // to ship. Listing them here claimed support the APK did not have, and
        // kept every AndroidX library's ar/fr translations in the build for no
        // reason. Add a locale back here at the same time as its values- folder,
        // never before.
        resourceConfigurations += listOf("en")

        /**
         * Screen orientation, because one APK now runs on two shapes of hardware.
         *
         * Staff tablets are held in landscape and that is what every screen was
         * laid out for. The self-service kiosk is a wall-mounted PORTRAIT panel —
         * forcing landscape on it rotates the whole interface ninety degrees on a
         * screen that cannot be turned, which is not a cosmetic problem but an
         * unusable one.
         *
         * It stays a manifest placeholder rather than a product flavour: a flavour
         * doubles every build variant and the signing config with it, for what is
         * one attribute. It reads from local.properties exactly like API_BASE_URL
         * already does, so a kiosk build is a one-line change on the machine that
         * makes it and nothing to remember anywhere else.
         *
         * The default is the existing value, so no tablet build changes.
         */
        manifestPlaceholders["screenOrientation"] = prop("SCREEN_ORIENTATION", "userLandscape")

        /**
         * The kiosk's hardware QR scanner.
         *
         * EMPTY BY DEFAULT, which disables it completely — a build says nothing
         * about a scanner and gets exactly the behaviour it had before this
         * existed. That default is deliberate twice over. Staff tablets have no
         * scanner and must not probe for one; and the kiosk carries a thermal
         * printer that may itself sit on a serial port, so opening ports on a
         * device nobody has characterised risks talking over it.
         *
         *   SCANNER_PORT=auto          probe every serial node the board exposes.
         *                              The log names the one that answered — this
         *                              is how the first kiosk tells us the answer.
         *   SCANNER_PORT=/dev/ttyS1    pin it, once that answer is known.
         *
         * The baud default is the engine's own factory default (guide p. 31).
         */
        buildConfigField("String", "SCANNER_PORT", "\"${prop("SCANNER_PORT", "")}\"")
        buildConfigField("int", "SCANNER_BAUD", prop("SCANNER_BAUD", "9600"))
    }

    /**
     * Release signing (§ distribution).
     *
     * The keystore path and its passwords come from local.properties — which is
     * untracked — or from the environment for CI. They are never written here: a
     * signing password in version control is a signing password in every clone,
     * and this key cannot be rotated. Losing or leaking it means the app can
     * never be updated, because Android identifies an app by its signing key.
     *
     * Attached to the release variant only when a keystore is actually
     * configured. Without that guard a machine that has no keystore — a CI
     * runner, a new laptop — would fail at CONFIGURATION time and be unable to
     * build debug or run tests either. Adding a release key must not cost
     * everyone else the ability to compile.
     */
    val releaseKeystore = prop("RELEASE_KEYSTORE", "")

    signingConfigs {
        create("release") {
            if (releaseKeystore.isNotBlank()) {
                storeFile = file(releaseKeystore)
                storePassword = prop("RELEASE_KEYSTORE_PASSWORD", "")
                keyAlias = prop("RELEASE_KEY_ALIAS", "fancy-checkin")
                // Defaults to the store password: `keytool` uses one password for
                // both unless told otherwise, which is the normal PKCS12 case.
                keyPassword = prop("RELEASE_KEY_PASSWORD", prop("RELEASE_KEYSTORE_PASSWORD", ""))
            }
        }
    }

    buildTypes {
        debug {
            // Points at the dev machine over the LAN by default. Cleartext is
            // permitted ONLY in this variant — see network_security_config.
            buildConfigField(
                "String",
                "API_BASE_URL",
                "\"${prop("API_BASE_URL_DEBUG", "http://10.0.2.2:5000/api/v1/")}\"",
            )
            isMinifyEnabled = false
        }
        release {
            buildConfigField(
                "String",
                "API_BASE_URL",
                "\"${prop("API_BASE_URL_RELEASE", "https://fancyrsvp.com/api/v1/")}\"",
            )
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Unsigned unless a keystore is configured — Android refuses to
            // install an unsigned APK, so a silent fallback would produce an
            // artifact that looks fine and cannot be used.
            if (releaseKeystore.isNotBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf(
            "/META-INF/{AL2.0,LGPL2.1}",
            "/META-INF/DEPENDENCIES",
        )
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

/**
 * Room schema JSON is committed to version control (spec §21.2).
 *
 * Migration tests run against every previously released schema, and
 * fallbackToDestructiveMigration is a release blocker — see CheckinDatabase.
 * Without these exported schemas there is nothing to test a migration against,
 * and a bad migration silently deletes check-ins that exist nowhere else.
 */
ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
    arg("room.generateKotlin", "true")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Offline backbone
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.sqlite.ktx)
    implementation(libs.sqlcipher)

    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.datastore.preferences)

    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.hilt.work)
    implementation(libs.androidx.hilt.navigation.compose)
    ksp(libs.androidx.hilt.compiler)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)

    implementation(libs.retrofit)
    implementation(libs.retrofit.serialization)
    implementation(libs.okhttp)
    debugImplementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    implementation(libs.camera.core)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.mlkit.barcode.bundled)

    /**
     * Kiosk scanner SDK, supplied by the hardware manufacturer as a bare JAR.
     *
     * Not in libs.versions.toml because it is not resolvable from any repository —
     * there is no group, no artifact, no version. It is a file, and the version
     * catalogue has nowhere to put a file. `app/libs/` is the conventional home.
     *
     * The JAR also carries the vendor's own demo Activities under
     * com.example.uartscandemo. Nothing references them and R8 strips them, but
     * they reference an R class that does not exist here — hence the -dontwarn in
     * proguard-rules.pro.
     */
    implementation(files("libs/uart_scan_pro.jar"))

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.mockk)
    testImplementation(libs.turbine)

    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.espresso)
    androidTestImplementation(libs.androidx.room.testing)
}
