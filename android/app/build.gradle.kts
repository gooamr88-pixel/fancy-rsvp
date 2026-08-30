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

    /*
     * The kiosk scanner SDK is a plain JAR plus a native library, not a Maven
     * artifact, so the two are wired up by hand — and they live in DIFFERENT
     * places on purpose:
     *
     *   app/src/main/jniLibs/<abi>/libts_serial_port.so   the native library
     *   app/libs/uart_scan_pro.jar                        the JNI wrapper
     *
     * jniLibs is AGP's default location, so it needs no sourceSets override at
     * all. An earlier version pointed jniLibs at `app/libs` to keep both in one
     * folder; that is worth avoiding twice over. It is custom configuration for
     * no gain, and it puts the .so files outside `app/src`, which is the tree the
     * deploy script actually copies — so the build failed on a machine where the
     * natives had silently never arrived.
     *
     * Four ABIs. The vendor also ships mips/mips64/armeabi, which the current NDK
     * has dropped and no device made this decade uses.
     *
     * If the .so for the running device's ABI is missing, `System.loadLibrary`
     * throws at class-init time inside the vendor code. HardwareScanSource treats
     * that as "no scanner attached" rather than letting it escape.
     */

    defaultConfig {
        applicationId = "com.fancyrsvp.checkin"
        // API 26 covers effectively every tablet in the market (spec §4).
        minSdk = 26
        targetSdk = 35
        /**
         * versionCode is generated; versionName is written by hand.
         *
         * ── Why it had to become automatic ──
         *
         * The public APK at fancyrsvp.com/download is now republished by
         * deploy-android.bat on every build. Android decides "is this an
         * upgrade?" purely on versionCode, and REFUSES an install whose code is
         * not greater than the one already on the device. Publishing a new APK
         * under a code that was already shipped means every tablet that has it
         * silently ignores the update — the file changes, nothing else does.
         * A hand-bumped constant cannot survive that; it will be forgotten, and
         * the failure is invisible until someone at a venue is on an old build.
         *
         * The deploy script passes VERSION_CODE as MINUTES SINCE THE EPOCH, so
         * it always increases, changes at most once a minute, and stays a long
         * way under Android's 2,100,000,000 ceiling for roughly four thousand
         * years. It jumps from 15 to about 29,800,000, which is a one-way door —
         * as every versionCode is.
         *
         * The fallback keeps a local or manual build working unchanged.
         *
         * versionName stays hand-written because it is the human label: it is
         * what a crash report prints, and "1.6.1" tells a support conversation
         * something that a minute count never could.
         */
        versionCode = prop("VERSION_CODE", "15").toInt()
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
         * Screen orientation.
         *
         * `fullSensor` — the app follows the physical sensor in all four
         * orientations, and does so REGARDLESS of the device's auto-rotate lock.
         * It replaces `userLandscape`, which was written when a staff tablet held
         * in two hands was the only hardware this ran on. It no longer is: the
         * self-service kiosk is a wall-mounted PORTRAIT panel, and forcing
         * landscape on a screen that cannot be turned is not a cosmetic problem
         * but an unusable one.
         *
         * NOT `fullUser`, which was tried first and did nothing. `fullUser` means
         * "respect the user's rotation preference" — and when auto-rotate is off,
         * which is the default on most tablets and on anything set up as a kiosk,
         * it degrades to `nosensor` and the app never turns at all. Deferring to a
         * device setting is the wrong call for a tool whose whole requirement is
         * that it works in either hand position, on hardware an usher does not
         * configure.
         *
         * Unlocking rotation is safe here for a reason that was already true:
         * `configChanges` in the manifest lists `orientation|screenSize|
         * screenLayout`, so the Activity is NOT recreated when the device turns.
         * The camera pipeline survives; Compose re-measures. The old comment
         * warning that rotation "disrupts the CameraX pipeline" described a
         * recreation that this manifest has always prevented.
         *
         * Still a placeholder rather than a hard-coded value, so a venue that
         * wants a fixed orientation on a particular unit can pin it from
         * local.properties — `SCREEN_ORIENTATION=userPortrait` — without a new
         * build variant.
         */
        manifestPlaceholders["screenOrientation"] = prop("SCREEN_ORIENTATION", "fullSensor")

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
