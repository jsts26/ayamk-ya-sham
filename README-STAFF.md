# نظام موظفي أيامك يا شام

حزمة واجهات موظفين منفصلة عن لوحة المدير الحالية، لموقع GitHub Pages:
`https://jsts26.github.io/ayamk-ya-sham/`

## محتويات الحزمة
- `staff/login.html`: تسجيل الدخول المشترك.
- `staff/orders.html`: موظف استقبال/متابعة الطلبات.
- `staff/kitchen.html`: المطبخ.
- `staff/cashier.html`: الكاشير.
- `staff/menu.html`: إدارة/اقتراح تعديلات القائمة عبر طلب موافقة المدير.
- `staff/delivery.html`: التوصيل للطلبات المسندة إلى الموظف.
- `assets/css/staff.css`, `assets/js/staff-supabase.js`, `assets/js/staff-app.js`
- `supabase/migrations/003_staff_delivery_status_security.sql`: إصلاح إضافي للتحقق من إسناد طلب التوصيل قبل تغيير حالته.

## قبل النشر — مطلوب
1. افتح `assets/js/staff-supabase.js`.
2. ضع **Supabase anon/public publishable key** الخاص بالمشروع في `SUPABASE_ANON_KEY`.
   - لا تضع `service_role` أو `secret key` في أي ملف واجهة.
   - رابط المشروع مضبوط على `https://gcmkqoypbilzokhcsypr.supabase.co`.
3. تأكد أن migrations السابقة الخاصة بـ `staff_profiles`, `approval_requests`, `staff_audit_log` وRPCs التالية قد نُفذت:
   - `current_staff_role()`
   - `request_manager_approval(...)`
   - `staff_update_order_status(...)`
   - `staff_record_payment(...)`
   - `manager_assign_delivery_order(...)`
4. شغّل SQL migration رقم 003 في Supabase SQL Editor. راجع النص أولًا وتأكد أن تعريف `staff_update_order_status` الحالي متوافق مع الأعمدة والسياسات المستخدمة في مشروعك.
5. ارفع محتويات المجلد إلى جذر مستودع `jsts26/ayamk-ya-sham` (لا ترفع المجلد الخارجي `ayamk-ya-sham-staff-system` كطبقة إضافية). لن تستبدل هذه الحزمة `index.html` أو ملفات `admin/` الموجودة.
6. في Supabase Authentication، أنشئ حسابًا لكل موظف ثم أضف صفًا مطابقًا في `staff_profiles` من حساب المدير/SQL Editor. لا تضف الموظفين إلى `admin_users`.

## مسارات GitHub Pages
الروابط تستخدم مسار المشروع `/ayamk-ya-sham/` ولا تعتمد على مسارات مطلقة من جذر النطاق. مسار المشروع مضبوط في `staff-supabase.js` ضمن `SITE_BASE_PATH`.

## الأدوار
- `orders`: يرى الطلبات التشغيلية ويؤكد الطلبات الجديدة عبر RPC.
- `kitchen`: يحدّث حالات التحضير عبر RPC.
- `cashier`: يسجل استلام النقد أو استلام تحويل للمراجعة فقط؛ لا يعتمد التحويل كمدفوع.
- `delivery`: يرى الطلبات المسندة إليه فقط، ويحدث حالاتها ضمن قواعد RPC.
- `menu`: يقرأ المنتجات ويرسل طلب موافقة للمدير بدل الكتابة المباشرة على المنتجات.

## ملاحظات أمنية مهمة
- الواجهة ليست حدًا أمنيًا؛ RLS وRPC داخل PostgreSQL هي مصدر الحماية الحقيقي.
- لا تمنح الموظفين صلاحيات مدير ولا تضفهم إلى `admin_users`.
- صفحة القائمة لا تعدّل `products` مباشرة؛ التعديل المقترح يُسجل في `approval_requests` ويحتاج إلى سير تنفيذ منفصل يراجعه المدير.
- لا تتضمن الحزمة مفتاحًا سريًا أو كلمة مرور.
- اختبر بحساب لكل دور، وبطلبات تجريبية، قبل الاستخدام الحقيقي.
