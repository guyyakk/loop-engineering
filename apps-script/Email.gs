/**
 * Email.gs — ส่งอีเมลสรุปการประชุม
 *
 * ใช้ MailApp เพื่อให้ขอสิทธิ์แค่ "ส่งเมลแทนผู้ใช้" ไม่ต้องขอสิทธิ์อ่านกล่องจดหมาย
 * DRY_RUN = true จะไม่ส่งจริง แต่เขียนทุกอย่างที่จะส่งลง Logger ให้ตรวจได้
 */

function sendSummaryEmails_(meeting, items) {
  var r = recipientsOf_(meeting);
  if (!r.to.length) {
    // ไม่ใช่ข้อผิดพลาดของระบบ แต่เป็นข้อมูลที่ยังไม่ครบ จึงคืนผลว่า "ข้าม" แทนการ throw
    // ถ้า throw ตรงนี้ ขั้นตอนที่ตามมา (สร้างรูปสำหรับ LINE) จะไม่ได้ทำงานเลย ทั้งที่ไม่เกี่ยวกับอีเมล
    return {
      skipped: 'no_recipients',
      dryRun: cfgBool_('DRY_RUN'),
      to: [], cc: r.cc, subject: subjectOf_(meeting, items),
      personalCount: 0, sentCount: 0,
      quotaLeft: MailApp.getRemainingDailyQuota()
    };
  }

  var subject = subjectOf_(meeting, items);
  var html = buildEmailHtml_(meeting, items);
  var options = {
    htmlBody: html,
    name: cfg_('SENDER_NAME'),
    cc: r.cc.join(',')
  };

  var sentCount = 0;
  var dry = cfgBool_('DRY_RUN');

  if (dry) {
    Logger.log('[DRY_RUN] อีเมลรวม to=%s cc=%s subject=%s', r.to.join(','), r.cc.join(','), subject);
    Logger.log('[DRY_RUN] html length=%s', html.length);
  } else {
    MailApp.sendEmail(r.to.join(','), subject, htmlToPlain_(html), options);
    sentCount++;
  }

  var personal = 0;
  if (cfgBool_('SEND_INDIVIDUAL')) {
    var people = peopleMap_();
    var byOwner = {};
    items.forEach(function (it) {
      var o = String(it.owner || '').trim();
      if (!o) return;
      if (!byOwner[o]) byOwner[o] = [];
      byOwner[o].push(it);
    });
    Object.keys(byOwner).forEach(function (owner) {
      var p = people[owner];
      if (!p || !p.email) return;
      var psubject = '[งานของคุณ] ' + String(meeting.title || '').trim() + ' — ' + fmtDate_(meeting.date);
      var phtml = buildPersonalEmailHtml_(meeting, owner, byOwner[owner]);
      if (dry) {
        Logger.log('[DRY_RUN] เมลรายบุคคล to=%s (%s งาน)', p.email, byOwner[owner].length);
      } else {
        MailApp.sendEmail(p.email, psubject, htmlToPlain_(phtml), {
          htmlBody: phtml,
          name: cfg_('SENDER_NAME')
        });
        sentCount++;
      }
      personal++;
    });
  }

  return {
    dryRun: dry,
    to: r.to,
    cc: r.cc,
    subject: subject,
    personalCount: personal,
    sentCount: sentCount,
    quotaLeft: MailApp.getRemainingDailyQuota()
  };
}

/** ข้อความสำรองสำหรับ mail client ที่ไม่แสดง HTML */
function htmlToPlain_(html) {
  return String(html)
    .replace(/<\/(tr|div|p|li|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/td>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
