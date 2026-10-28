
package com.rkai.apkbuilder;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.ScrollView;

public class MainActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(24, 32, 24, 24);
        layout.setBackgroundColor(Color.rgb(12, 18, 38));

        TextView title = new TextView(this);
        title.setText("RK AI APK Builder");
        title.setTextSize(26);
        title.setTextColor(Color.CYAN);
        title.setGravity(Gravity.CENTER);
        layout.addView(title);

        TextView info = new TextView(this);
        info.setText("अपना ऐप बनाने का आइडिया लिखें");
        info.setTextColor(Color.WHITE);
        info.setTextSize(17);
        info.setPadding(0, 24, 0, 12);
        layout.addView(info);

        EditText appName = new EditText(this);
        appName.setHint("ऐप का नाम लिखें");
        appName.setSingleLine(true);
        appName.setTextColor(Color.WHITE);
        appName.setHintTextColor(Color.LTGRAY);
        layout.addView(appName);

        EditText idea = new EditText(this);
        idea.setHint("जैसे: पढ़ाई, गेम या टॉर्च ऐप");
        idea.setTextColor(Color.WHITE);
        idea.setHintTextColor(Color.LTGRAY);
        idea.setMinLines(3);
        idea.setGravity(Gravity.TOP);
        layout.addView(idea);

        Button button = new Button(this);
        button.setText("ऐप बनाने का अनुरोध तैयार करें");
        layout.addView(button);

        TextView result = new TextView(this);
        result.setTextColor(Color.WHITE);
        result.setTextSize(16);
        result.setPadding(0, 20, 0, 0);
        layout.addView(result);

        button.setOnClickListener(v -> {
            String name = appName.getText().toString().trim();
            String details = idea.getText().toString().trim();

            if (name.isEmpty() || details.isEmpty()) {
                result.setText("कृपया ऐप का नाम और आइडिया दोनों लिखें।");
            } else {
                result.setText(
                    "आपके ऐप का अनुरोध:\n\n" +
                    "ऐप का नाम: " + name +
                    "\n\nआइडिया: " + details +
                    "\n\nअगला चरण: इस अनुरोध से Android प्रोजेक्ट और APK बनाना।"
                );
            }
        });

        ScrollView scroll = new ScrollView(this);
        scroll.addView(layout);
        setContentView(scroll);
    }
}
