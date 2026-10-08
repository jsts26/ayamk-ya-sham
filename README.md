# أيامك يا شام — ملفات الربط مع Supabase

## الملفات
- `index.html`: المينو الحالي مع تحميل الأصناف من Supabase عند وجود بيانات متاحة. إذا لم توجد أصناف في قاعدة البيانات أو فشل الاتصال، يعرض المينو الأصلي كحل احتياطي.
- `assets/js/supabase.js`: إعداد الاتصال باستخدام Project URL وPublishable key فقط.
- `admin/login.html`: تسجيل الدخول باستخدام Supabase Auth.
- `admin/index.html`: لوحة إدارة أولية للأقسام والأصناف، الأسعار (ومنها السعر عند الطلب)، المجموعات والأحجام، الإتاحة، والصور في Storage.

## النشر
انسخ محتويات هذه الحزمة إلى جذر مستودع GitHub `jsts26/ayamk-ya-sham` مع الحفاظ على بنية المجلدات. ثم افتح:
- الموقع: `https://jsts26.github.io/ayamk-ya-sham/`
- لوحة الدخول: `https://jsts26.github.io/ayamk-ya-sham/admin/login.html`

## قبل الاستخدام
1. من Supabase → Authentication → URL Configuration، أضف `https://jsts26.github.io/ayamk-ya-sham/` إلى Redirect URLs. اجعل Site URL مناسباً للموقع المنشور.
2. تأكد أن حساب Auth الخاص بك موجود في `public.admin_users`.
3. إذا لم تكن الأعمدة التالية قد أضيفت، نفّذها مرة واحدة في SQL Editor:

```sql
alter table public.products alter column price drop not null;
alter table public.products add column if not exists group_name_ar text;
alter table public.products add column if not exists group_name_en text;
alter table public.products add column if not exists size_label_ar text;
alter table public.products add column if not exists size_label_en text;
```

4. تأكد من وجود جدول `categories` وعمود `is_active` وسياسات RLS التي تسمح بقراءة الأقسام النشطة والأصناف المتاحة للعامة، وتقيّد التعديل بالمدير.
5. تأكد من وجود bucket باسم `menu-images` وسياسات رفع/تعديل/حذف خاصة بالمدير وقراءة عامة للصور.
6. أضف الأقسام والأصناف من لوحة الإدارة. عند وجود أصناف في Supabase سيعرض المينو الأصناف من قاعدة البيانات؛ إن كانت القاعدة فارغة فسيبقى المينو الأصلي ظاهراً كاحتياط.

## تنبيهات
- استخدمنا Publishable key العام فقط. لا تضع `service_role` أو Secret key في ملفات المتصفح.
- إرسال الطلبات ما زال عبر واتساب كما في المينو الأصلي. لم نفتح الكتابة العامة إلى `orders` أو `order_items`، لأنها تحتاج تدفقاً آمناً من جهة الخادم.
- لوحة الإدارة الحالية لإدارة الأقسام والأصناف والصور؛ لا تدّعي إدارة العروض أو الطلبات حتى تتم إضافة واجهاتهما.
