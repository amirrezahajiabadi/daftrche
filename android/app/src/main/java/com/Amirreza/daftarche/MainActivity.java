package com.Amirreza.daftarche;

import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Edge-to-edge, the way Android 15 (API 35) requires it.
 *
 * A targetSdk of 35 or more makes the window edge-to-edge whether the app asks
 * for it or not, so the old "fit the system windows" opt-out is gone: the page
 * is drawn from the very top of the screen to the very bottom, behind the status
 * bar and under the navigation / gesture bar.
 *
 * What the WebView cannot tell on its own is how tall those bars are.
 * env(safe-area-inset-*) on Android only reports display cutouts, not the system
 * bars, so the page would put its header under the clock. The window insets are
 * therefore measured here and handed to the page as custom properties:
 * --sat, --sab, --inset-top, and --inset-bottom. Every page, dialog and the
 * bottom navigation already pad themselves from those, so one measurement here
 * covers the whole app, and the page keeps painting its own background behind
 * the bars instead of leaving a band of Activity background at the top.
 */
public class MainActivity extends BridgeActivity {
    private int cachedTop = 0;
    private int cachedBottom = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        /* Storage, stated outright instead of trusted to a default. The app keeps
           every task, highlight, note and reading position in localStorage and
           IndexedDB, and both must survive the app being killed — a WebView with
           DOM storage off would look like data loss to the reader. */
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setJavaScriptEnabled(true);
            settings.setTextZoom(100);
            settings.setMediaPlaybackRequiresUserGesture(false);

            // Clean stale WebView cache on APK update
            try {
                int currentVersionCode = BuildConfig.VERSION_CODE;
                SharedPreferences prefs = getSharedPreferences("daftarche_webview_prefs", MODE_PRIVATE);
                int savedVersionCode = prefs.getInt("last_version_code", -1);
                if (currentVersionCode > savedVersionCode) {
                    webView.clearCache(true);
                    prefs.edit().putInt("last_version_code", currentVersionCode).apply();
                }
            } catch (Exception ignored) {}

            // Native bridge for synchronous boot safe area & status bar control
            webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        }

        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            // The keyboard is not a bar to pad by: the page resizes for it
            // (interactive-widget=resizes-content), so only the bars count.
            //
            // Two units, one number: WindowInsets are in physical pixels and CSS
            // padding is in CSS pixels, so the raw value would ask a 3x phone for
            // a 63px strip at the top instead of 24 — a band of empty page, and
            // a narrower column for every line of text. Divided by the display
            // density, the page gets the same number of dp the system used.
            float density = getResources().getDisplayMetrics().density;
            if (density <= 0f) density = 1f;
            int top = Math.max(0, Math.round(bars.top / density));
            int bottom = Math.max(0, Math.round(bars.bottom / density));
            cachedTop = top;
            cachedBottom = bottom;
            applyInsetsToWebView(top, bottom);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(getWindow().getDecorView());

        // Hardware back button navigation handling
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge() == null ? null : getBridge().getWebView();
                if (web != null) {
                    String js = "(function() {"
                        + "  if (typeof window.__daftarcheCloseTopDialog === 'function' && window.__daftarcheCloseTopDialog()) return true;"
                        + "  var open = Array.from(document.querySelectorAll('.overlay, .sheet')).filter(function(el){ return !el.hidden && el.getClientRects().length > 0; });"
                        + "  if (open.length > 0) {"
                        + "    open[open.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));"
                        + "    return true;"
                        + "  }"
                        + "  var reader = document.getElementById('readerView');"
                        + "  if (reader && !reader.hidden) {"
                        + "    window.dispatchEvent(new CustomEvent('close-reader'));"
                        + "    return true;"
                        + "  }"
                        + "  var trail = window.history && window.history.state && window.history.state.trail;"
                        + "  if (Array.isArray(trail) && trail.length > 1) {"
                        + "    window.history.back();"
                        + "    return true;"
                        + "  }"
                        + "  if (web.canGoBack()) {"
                        + "    web.goBack();"
                        + "    return true;"
                        + "  }"
                        + "  return false;"
                        + "})()";
                    web.evaluateJavascript(js, result -> {
                        if (!"true".equals(result)) {
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                            setEnabled(true);
                        }
                    });
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        if (cachedTop > 0 || cachedBottom > 0) {
            applyInsetsToWebView(cachedTop, cachedBottom);
        }
    }

    @Override
    public void onBackPressed() {
        getOnBackPressedDispatcher().onBackPressed();
    }

    private void applyInsetsToWebView(int top, int bottom) {
        WebView web = getBridge() == null ? null : getBridge().getWebView();
        if (web != null) {
            String js = String.format(
                "window.__ANDROID_INSETS__={top:%d,bottom:%d};"
                    + "document.documentElement.style.setProperty('--sat','%dpx');"
                    + "document.documentElement.style.setProperty('--sab','%dpx');"
                    + "document.documentElement.style.setProperty('--inset-top','%dpx');"
                    + "document.documentElement.style.setProperty('--inset-bottom','%dpx');",
                top, bottom, top, bottom, top, bottom);
            web.post(() -> web.evaluateJavascript(js, null));
        }
    }

    private int parseCssColor(String colorStr, int fallbackColor) {
        if (colorStr == null || colorStr.trim().isEmpty()) return fallbackColor;
        String s = colorStr.trim();
        try {
            if (s.startsWith("#")) {
                return Color.parseColor(s);
            }
            if (s.startsWith("rgb")) {
                int start = s.indexOf('(');
                int end = s.indexOf(')');
                if (start != -1 && end != -1) {
                    String[] parts = s.substring(start + 1, end).split("[,/]");
                    if (parts.length >= 3) {
                        int r = Math.round(Float.parseFloat(parts[0].trim()));
                        int g = Math.round(Float.parseFloat(parts[1].trim()));
                        int b = Math.round(Float.parseFloat(parts[2].trim()));
                        int a = 255;
                        if (parts.length >= 4) {
                            float alpha = Float.parseFloat(parts[3].trim());
                            if (alpha <= 1.0f) a = Math.round(alpha * 255);
                            else a = Math.round(alpha);
                        }
                        return Color.argb(a, r, g, b);
                    }
                }
            }
        } catch (Exception ignored) {}
        return fallbackColor;
    }

    public class AndroidBridge {
        @JavascriptInterface
        public int getTopInset() {
            return cachedTop;
        }

        @JavascriptInterface
        public int getBottomInset() {
            return cachedBottom;
        }

        @JavascriptInterface
        public void setSystemBars(String bgColorHex, boolean isDark) {
            runOnUiThread(() -> {
                try {
                    Window window = getWindow();
                    int color = parseCssColor(bgColorHex, isDark ? 0xFF0D1B2A : 0xFFF4F0E6);
                    window.setStatusBarColor(color);
                    window.setNavigationBarColor(color);

                    WindowInsetsControllerCompat controller =
                        WindowCompat.getInsetsController(window, window.getDecorView());
                    if (controller != null) {
                        // Light status bars = dark icons when background is light (!isDark)
                        controller.setAppearanceLightStatusBars(!isDark);
                        controller.setAppearanceLightNavigationBars(!isDark);
                    }
                } catch (Exception ignored) {}
            });
        }
    }
}
