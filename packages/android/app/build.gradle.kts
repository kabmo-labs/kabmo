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
     * The shell's own version, from `version.properties`.
     *
     * ONE source, and it is a file rather than a `-P` flag: the release pipeline
     * bumps that file (`release/release-android.mjs`) and the console compares
     * the published asset's version against the one the running app reports on
     * its User-Agent. A version handed in at build time would make the number
     * the pipeline published and the number the app reports two separate
     * decisions, and the download button's whole job is comparing them.
     *
     * It is deliberately NOT the app's release tag any more. Tying the two made
     * a shell-only fix ship under a server version, and a server release ship an
     * APK whose version said nothing about whether the shell had changed.
     *
     * `versionCode` still comes from the workflow (`-PkabmoVersionCode`), because
     * Android refuses an install whose code is not higher than the installed
     * one: it is a monotonic counter, not a version, and a local build falls
     * back to `1`.
     */
    val shellProperties = Properties().apply {
        val file = rootProject.file("version.properties")
        check(file.exists()) { "packages/android/version.properties is missing — it declares versionName" }
        file.inputStream().use { load(it) }
    }
    val appVersionName = shellProperties.getProperty("versionName")?.trim()?.takeIf { it.isNotEmpty() }
        ?: error("version.properties declares no versionName")
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
