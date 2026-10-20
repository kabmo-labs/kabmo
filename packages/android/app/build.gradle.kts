import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * The Kabmo Android shell.
 *
 * Deliberately dependency-free: no AndroidX, no Compose, no Material. The app is
 * one Activity hosting a WebView plus a small native settings screen, so the
 * APK carries only the Kotlin stdlib and this source. Every library added here
 * is weight the shell does not need.
 */
android {
    namespace = "dev.kabmo.shell"
    compileSdk = 35

    /**
     * A real release key when the machine has one, the debug key otherwise.
     *
     * `keystore.properties` is gitignored, so a checkout without it still
     * builds an installable APK — which is what makes a sideloaded build
     * possible without asking every contributor for a signing secret.
     */
    val keystoreProps = rootProject.file("keystore.properties")
    val hasReleaseKey = keystoreProps.exists()
    val releaseKeystore = Properties().apply {
        if (hasReleaseKey) keystoreProps.inputStream().use { load(it) }
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(releaseKeystore.getProperty("storeFile"))
                storePassword = releaseKeystore.getProperty("storePassword")
                keyAlias = releaseKeystore.getProperty("keyAlias")
                keyPassword = releaseKeystore.getProperty("keyPassword")
            }
        }
    }

    /**
     * The version the release pipeline hands in, or the checked-in default.
     *
     * The release workflow passes `-PkabmoVersionName=<tag without v>` and
     * `-PkabmoVersionCode=<run number>`, so the APK attached to a GitHub release
     * names the same version as the release it belongs to. Android refuses an
     * install whose `versionCode` is not higher than the installed one, so the
     * code has to move on every release — the run number is monotonic, and a
     * local build falls back to `1`.
     *
     * Gradle properties rather than an env var: `versionName` is read at
     * CONFIGURATION time, and a property is what `-P` sets before that runs.
     */
    val appVersionName = (project.findProperty("kabmoVersionName") as String?)?.trim()
        ?.takeIf { it.isNotEmpty() } ?: "0.1.0"
    val appVersionCode = (project.findProperty("kabmoVersionCode") as String?)?.toIntOrNull()
        ?.takeIf { it > 0 } ?: 1

    defaultConfig {
        applicationId = "dev.kabmo.shell"
        minSdk = 24
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName

        // The token the console reads to know it is running inside this APK and
        // which version that APK is. `KabmoAndroid/0.1.0` — one word, so it
        // survives the UA's space-separated token grammar, and namespaced so it
        // cannot be confused with a browser's own version.
        buildConfigField("String", "SHELL_UA_TOKEN", "\"KabmoAndroid/$appVersionName\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // A real keystore when `keystore.properties` exists (gitignored);
            // otherwise the debug key, so a release APK is always buildable for
            // sideloading. See README.md → Signing.
            signingConfig = if (hasReleaseKey) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    // `BuildConfig.VERSION_NAME` is what the JS bridge reports to the page. AGP 8
    // stops generating the class unless it is asked for.
    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // The only tests are plain JVM tests over `UrlNormalizer` — no Android
    // framework, no Robolectric — so the runner is JUnit 4 and nothing else.
    testImplementation("junit:junit:4.13.2")
}
