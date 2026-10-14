package in.vcomingle.app;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Stores only opaque server session tokens, encrypted with an Android Keystore key. */
@CapacitorPlugin(name = "SecureSessionStorage")
public class SecureSessionStoragePlugin extends Plugin {
    private android.content.SharedPreferences preferences() throws Exception {
        MasterKey key = new MasterKey.Builder(getContext())
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build();
        return EncryptedSharedPreferences.create(getContext(), "vcomingle_secure_session", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
    }

    @com.getcapacitor.PluginMethod
    public void get(PluginCall call) {
        try { JSObject result = new JSObject(); result.put("value", preferences().getString(call.getString("key"), "")); call.resolve(result); }
        catch (Exception error) { call.reject("Secure storage is unavailable.", error); }
    }
    @com.getcapacitor.PluginMethod
    public void set(PluginCall call) {
        try { preferences().edit().putString(call.getString("key"), call.getString("value", "")).apply(); call.resolve(); }
        catch (Exception error) { call.reject("Secure storage is unavailable.", error); }
    }
    @com.getcapacitor.PluginMethod
    public void remove(PluginCall call) {
        try { preferences().edit().remove(call.getString("key")).apply(); call.resolve(); }
        catch (Exception error) { call.reject("Secure storage is unavailable.", error); }
    }
}
