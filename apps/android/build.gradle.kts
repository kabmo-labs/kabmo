// Root build file. Plugin versions are declared here and applied in :app, so
// the two Gradle files cannot disagree about which AGP/Kotlin produced an APK.
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}
