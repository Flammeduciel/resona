package com.resona

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(com.resona.core.ResonaPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Le processus « :analysis » (ProcessingService) n'a pas besoin de React Native.
    if (currentProcessName().endsWith(":analysis")) return
    loadReactNative(this)
  }

  private fun currentProcessName(): String =
    try { java.io.File("/proc/self/cmdline").readText().trim { it <= ' ' } } catch (_: Throwable) { "" }
}
