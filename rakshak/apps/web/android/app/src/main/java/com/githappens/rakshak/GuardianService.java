package com.githappens.rakshak;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Keeps the guardian's phone listening while RAKSHAK is in the background. Without it Android freezes a backgrounded
 * app within about a minute, its live connection drops and alerts stop arriving. Shows the ongoing
 * "RAKSHAK Guardian is on" notification, like other safety apps.
 */
public class GuardianService extends Service {

    static final String CHANNEL = "rakshak-guard";
    static final int ID = 7001;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String child = intent != null && intent.getStringExtra("child") != null ? intent.getStringExtra("child") : "your child";
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "RAKSHAK Guardian is on", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps alerts arriving while the app is in the background");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_rakshak)
            .setColor(0xFF0A84FF)
            .setContentTitle("RAKSHAK Guardian is on")
            .setContentText("Safety alerts about " + child + " will arrive here")
            .setOngoing(true)
            .setContentIntent(tap)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(ID, n);
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
