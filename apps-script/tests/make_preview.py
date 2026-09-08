"""สร้างไฟล์ HTML สำหรับเปิดฟอร์มในเบราว์เซอร์ธรรมดา เพื่อทดสอบ UI โดยไม่ต้อง deploy

FormUi.html เรียก google.script.run ซึ่งมีเฉพาะตอนรันบน Apps Script
สคริปต์นี้จึงแทรก stub ของ google.script.run เข้าไปก่อนโค้ดจริง แล้วเขียนเป็นไฟล์ใหม่

วิธีใช้:  python tests/make_preview.py [ไฟล์ปลายทาง]
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'FormUi.html')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'preview.html')

STUB = """
<script>
// ---- stub ของ google.script.run สำหรับทดสอบ UI เท่านั้น ----
var CALLS = [];
var google = { script: { run: (function () {
  var h = {};
  function later(fn) { setTimeout(fn, 60); }
  var api = {
    withSuccessHandler: function (f) { h.s = f; return api; },
    withFailureHandler: function (f) { h.e = f; return api; },

    formInit: function () {
      CALLS.push('formInit');
      later(function () {
        h.s({
          people: ['สมชาย', 'สุดา', 'ประเสริฐ'],
          meeting: { meeting_id: '', title: '', date: '2026-09-08', start_time: '', end_time: '',
                     location: '', chair: '', note_taker: '', attendees: [], decisions: '',
                     open_issues: '', next_meeting_at: '', sent: false },
          items: []
        });
      });
    },

    formSave: function (p, check) {
      CALLS.push('formSave:' + (p.items || []).length);
      later(function () {
        h.s({ meeting_id: 'MOM-2026-001', saved_at: '10:12:33',
              item_count: (p.items || []).length, errors: [], warnings: [] });
      });
    },

    webPreview: function (p) {
      CALLS.push('webPreview:' + (p.items || []).length);
      later(function () {
        var errors = [];
        if (!p.title) errors.push('ยังไม่ได้กรอก ชื่อการประชุม (title)');
        if (!(p.attendees || []).length) errors.push('ยังไม่ได้กรอกผู้เข้าร่วม (attendees)');
        (p.items || []).forEach(function (it, i) {
          if (!it.owner) errors.push('งานแถวที่ ' + (i + 1) + ': ยังไม่ได้ระบุผู้รับผิดชอบ (owner)');
        });
        h.s({
          meeting_id: 'MOM-2026-001', errors: errors,
          warnings: errors.length ? [] : ['ผู้เข้าร่วม "แขกรับเชิญ" ไม่มีในชีต people จะไม่ได้รับอีเมล'],
          dry_run: true, already_sent: false, sent_at: '',
          to: ['somchai@example.com', 'suda@example.com'], cc: [],
          send_individual: false, item_count: (p.items || []).length
        });
      });
    },

    webFinish: function (p) {
      CALLS.push('webFinish:' + (p.items || []).length);
      later(function () {
        h.s({
          ok: true, meeting_id: 'MOM-2026-001', errors: [], warnings: [],
          dry_run: true, recipients: 2, personal: 0, quota_left: 97,
          image_url: 'https://example.com/fake.png', image_name: 'MOM-2026-001.png',
          line_text: '📋 สรุปประชุม: ทดสอบระบบ\\n🗓 8 ก.ย. 2026\\n\\n📌 งานที่ต้องทำ (1)\\n1. สมชาย — ทดสอบปุ่มปิดประชุม · ครบ 10 ก.ย. 2026'
        });
      });
    }
  };
  return api;
})() } };
</script>
"""


def main():
    html = io.open(SRC, encoding='utf-8').read()
    if '<script>' not in html:
        raise SystemExit('ไม่พบ <script> ใน FormUi.html')
    html = html.replace('<script>', STUB.strip() + '\n<script>', 1)
    html = html.replace('<title>', '<title>[PREVIEW] ', 1)
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(html)
    sys.stdout.write('wrote ' + OUT + '\n')
    sys.stdout.write('script blocks: %d\n' % len(re.findall(r'<script>', html)))


if __name__ == '__main__':
    main()
