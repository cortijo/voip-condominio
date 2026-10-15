package br.com.interfone.virtual

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Notificações locais: avisos, mensagens do chat, chamadas recebidas e o aviso do serviço. */
object Notifier {
    const val CH_SERVICE = "servico"
    const val CH_INFO = "avisos"
    const val CH_CALL = "chamadas"
    const val ID_SERVICE = 1
    const val ID_CALL = 2
    private var nextId = 100

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH_SERVICE, "Conexão do interfone", NotificationManager.IMPORTANCE_LOW)
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_INFO, "Avisos e mensagens", NotificationManager.IMPORTANCE_HIGH)
        )
        val call = NotificationChannel(CH_CALL, "Chamadas", NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIC)
                    .build()
            )
            enableVibration(true)
        }
        nm.createNotificationChannel(call)
    }

    private fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx, 0,
        Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    private fun canNotify(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun post(ctx: Context, id: Int, n: Notification) {
        if (!canNotify(ctx)) return
        try { NotificationManagerCompat.from(ctx).notify(id, n) } catch (e: SecurityException) { /* sem permissão */ }
    }

    fun serviceNotification(ctx: Context): Notification =
        NotificationCompat.Builder(ctx, CH_SERVICE)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Interfone Virtual")
            .setContentText("Conectado — você receberá chamadas e avisos")
            .setContentIntent(openApp(ctx))
            .setOngoing(true)
            .setSilent(true)
            .build()

    fun notice(ctx: Context, n: Notice) {
        val n2 = NotificationCompat.Builder(ctx, CH_INFO)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(n.title)
            .setContentText(n.body.ifBlank { "Novo aviso do condomínio" })
            .setStyle(NotificationCompat.BigTextStyle().bigText(n.body.ifBlank { n.title }))
            .setContentIntent(openApp(ctx))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        post(ctx, nextId++, n2)
    }

    fun chat(ctx: Context, m: ChatMessage) {
        val n = NotificationCompat.Builder(ctx, CH_INFO)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(m.operatorName.ifBlank { "Portaria" })
            .setContentText(m.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(m.body))
            .setContentIntent(openApp(ctx))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        post(ctx, nextId++, n)
    }

    fun incomingCall(ctx: Context, who: String) {
        val n = NotificationCompat.Builder(ctx, CH_CALL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Chamada de $who")
            .setContentText("Toque para atender")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setContentIntent(openApp(ctx))
            .setFullScreenIntent(openApp(ctx), true)
            .setOngoing(true)
            .setAutoCancel(false)
            .build()
        n.flags = n.flags or Notification.FLAG_INSISTENT   // toca até atender/encerrar
        post(ctx, ID_CALL, n)
    }

    fun cancelCall(ctx: Context) {
        try { NotificationManagerCompat.from(ctx).cancel(ID_CALL) } catch (e: Exception) { /* ignora */ }
    }
}
