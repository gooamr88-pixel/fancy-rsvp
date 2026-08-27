# R8 rules for the check-in app.
#
# Two things here are correctness-critical rather than optimisation hygiene:
#
#   1. kotlinx.serialization relies on generated serializers reachable by name.
#      Stripping them makes every API response fail to parse in RELEASE only —
#      the build succeeds, the debug variant works, and the release APK cannot
#      talk to the server. That is the worst possible place to discover it.
#
#   2. Room and SQLCipher load native/generated classes reflectively.

# ── kotlinx.serialization ──
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Keep every @Serializable model and its generated serializer.
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}
-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <2>$<3> {
    kotlinx.serialization.KSerializer serializer(...);
}
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1>$Companion {
    kotlinx.serialization.KSerializer serializer(...);
}

-keep,includedescriptorclasses class com.fancyrsvp.checkin.data.remote.**$$serializer { *; }
-keepclassmembers class com.fancyrsvp.checkin.data.remote.** {
    *** Companion;
}

# ── Retrofit / OkHttp ──
-keepattributes Signature, Exceptions
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# ── Room ──
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-dontwarn androidx.room.paging.**

# ── SQLCipher ──
-keep class net.zetetic.database.** { *; }
-dontwarn net.zetetic.database.**

# ── ML Kit barcode (bundled model) ──
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# ── Kiosk scanner SDK (com.tool.*, from libs/uart_scan_pro.jar) ──
#
# This is the third correctness-critical block, and it fails in exactly the way
# the header warns about: the native library calls BACK into Java by name.
#
#   libts_serial_port.so  ->  com.tool.SerialPort.open / SerialPort_open
#   the vendor's decode loop  ->  ScanActivity$TsDataCallBack.ts_get_data_fun
#                             ->  ScanActivity$TsStateCallBack.ts_scan_state_fun
#
# JNI resolves those by their exact string names. R8 has no way to see the call
# — it lives in compiled ARM code — so without a keep rule it renames them, the
# lookup fails at runtime, and NO SCAN EVER ARRIVES. Debug builds are unminified
# and work perfectly, so this would ship green and die at a door.
-keep class com.tool.** { *; }
-keepclassmembers class com.tool.** {
    native <methods>;
}

# Our own implementations of the two callback interfaces. Keeping the interface
# is not enough on its own — the overriding method has to keep the name too, or
# it no longer overrides the kept signature.
-keepclassmembers class * implements com.tool.ScanActivity$TsDataCallBack {
    public int ts_get_data_fun(byte[], byte[], int);
}
-keepclassmembers class * implements com.tool.ScanActivity$TsStateCallBack {
    public int ts_scan_state_fun(byte[], byte);
}

# The vendor shipped their demo Activities inside the same JAR. Nothing here
# references them and R8 removes them, but they import an R class that only
# existed in the demo project, so the reference cannot be resolved.
-dontwarn com.example.uartscandemo.**

# ── Log hygiene (§20.7) ──
# Verbose and debug logging must be absent from release builds. Guest names must
# never reach a log statement in any variant, but this removes the calls outright
# so a future mistake cannot leak through one.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
}
