package in.vcomingle.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // Register before the bridge is created so JavaScript can request the
        // same Android runtime permissions that WebView needs for getUserMedia.
        registerPlugin(MediaPermissionsPlugin.class);
        registerPlugin(SecureSessionStoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
