package in.vcomingle.app;

import android.Manifest;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Exposes Android's camera and microphone runtime grants to the bundled web
 * app. Capacitor's inherited checkPermissions/requestPermissions methods are
 * intentionally used so the promise resolves only after the system prompt.
 */
@CapacitorPlugin(
    name = "MediaPermissions",
    permissions = {
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class MediaPermissionsPlugin extends Plugin {}
