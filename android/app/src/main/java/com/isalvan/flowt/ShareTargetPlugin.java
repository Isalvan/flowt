package com.isalvan.flowt;

import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Receives images shared to Flowt from other apps ("Compartir" → Flowt) and hands the
 * newest one to the web layer, which opens it in the ticket reader.
 *
 * The image is copied into the app cache so the web layer can read it through the
 * Capacitor file server; the share grant on the original content URI does not outlive
 * the intent. Only one share is kept: a newer one replaces an unread older one.
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {
    private static final long MAX_BYTES = 25L * 1024 * 1024;
    private JSObject pending;

    @Override
    public void load() {
        handleIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleIntent(intent);
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (this) {
            if (pending != null) result.put("share", pending);
            pending = null;
        }
        call.resolve(result);
    }

    private void handleIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();
        if (type == null || !type.startsWith("image/")) return;
        Uri uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
        // Consume the intent so a configuration change or relaunch does not import it twice.
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        if (uri == null || !isForeignContentUri(uri)) return;
        File file = copyToCache(uri, type);
        if (file == null) return;
        JSObject share = new JSObject();
        share.put("path", file.getAbsolutePath());
        share.put("mimeType", type);
        synchronized (this) {
            pending = share;
        }
        notifyListeners("shareReceived", new JSObject());
    }

    /**
     * Only content shared by another app: never file:// paths or this app's own providers,
     * which would let any app make Flowt read its private files on that app's behalf.
     */
    private boolean isForeignContentUri(Uri uri) {
        if (!ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) return false;
        String authority = uri.getAuthority();
        String own = getContext().getPackageName();
        return authority != null && !authority.equals(own) && !authority.startsWith(own + ".");
    }

    private File copyToCache(Uri uri, String type) {
        File dir = new File(getContext().getCacheDir(), "shared");
        if (!dir.exists() && !dir.mkdirs()) return null;
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        String ext = type.equals("image/png") ? ".png" : type.equals("image/webp") ? ".webp" : ".jpg";
        File out = new File(dir, "ticket-" + System.currentTimeMillis() + ext);
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream in = resolver.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) return null;
            byte[] buffer = new byte[64 * 1024];
            long total = 0;
            int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > MAX_BYTES) {
                    out.delete();
                    return null;
                }
                os.write(buffer, 0, read);
            }
            return out;
        } catch (Exception e) {
            Logger.error("ShareTarget", "Could not read the shared image", e);
            out.delete();
            return null;
        }
    }
}
