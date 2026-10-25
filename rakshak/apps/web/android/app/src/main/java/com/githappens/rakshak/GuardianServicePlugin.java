package com.githappens.rakshak;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Starts and stops GuardianService from the web app (the guardian's phone only). */
@CapacitorPlugin(name = "GuardianService")
public class GuardianServicePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Intent i = new Intent(getContext(), GuardianService.class).putExtra("child", call.getString("child", "your child"));
        try {
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject("could not start: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), GuardianService.class));
        call.resolve();
    }
}
