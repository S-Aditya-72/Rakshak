package com.githappens.rakshak;

import android.graphics.Color;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Paints the window behind the status and navigation bars in the current screen's colour.
 * On Android System WebView older than 140 the web view sits inside the bars, so without this the bars show the
 * theme's default (white) whatever the screen looks like.
 */
@CapacitorPlugin(name = "ScreenColor")
public class ScreenColorPlugin extends Plugin {

    @PluginMethod
    public void set(PluginCall call) {
        String color = call.getString("color", "#07070B");
        int parsed;
        try {
            parsed = Color.parseColor(color);
        } catch (IllegalArgumentException e) {
            call.reject("bad color");
            return;
        }
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().getDecorView().setBackgroundColor(parsed);
            call.resolve();
        });
    }
}
