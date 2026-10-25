package com.githappens.rakshak;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ScreenColorPlugin.class);
        registerPlugin(GuardianServicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
