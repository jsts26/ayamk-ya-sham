-- أيامك يا شام: إضافة الطلب داخل المحل وطلبات الموظفين مع الحفاظ على الطلبات القديمة.
-- نفّذ هذا الملف مرة واحدة في Supabase SQL Editor بعد مراجعة محتواه.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'delivery'
    CHECK (order_type IN ('delivery','dine_in','pickup')),
  ADD COLUMN IF NOT EXISTS table_number integer NULL CHECK (table_number BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS order_source text NOT NULL DEFAULT 'website'
    CHECK (order_source IN ('website','table_qr','staff'));

CREATE TABLE IF NOT EXISTS public.restaurant_tables (
  table_number integer PRIMARY KEY CHECK (table_number BETWEEN 1 AND 10),
  table_name text NOT NULL,
  qr_token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage restaurant tables" ON public.restaurant_tables;
CREATE POLICY "Admins manage restaurant tables" ON public.restaurant_tables
  FOR ALL TO authenticated USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_tables TO authenticated;
REVOKE ALL ON public.restaurant_tables FROM anon;

INSERT INTO public.restaurant_tables (table_number, table_name)
SELECT n, 'طاولة ' || n FROM generate_series(1,10) AS n
ON CONFLICT (table_number) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_customer_order_v2(
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_delivery_zone_id uuid,
  p_payment_method text,
  p_items jsonb,
  p_customer_notes text DEFAULT NULL,
  p_language text DEFAULT 'ar',
  p_payment_reference text DEFAULT NULL,
  p_order_type text DEFAULT 'delivery',
  p_table_token text DEFAULT NULL,
  p_table_number integer DEFAULT NULL,
  p_staff_order boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_order_id uuid;
  v_order_number bigint;
  v_subtotal numeric(12,2) := 0;
  v_delivery_fee numeric(12,2) := 0;
  v_total numeric(12,2);
  v_table integer := NULL;
  v_item jsonb;
  v_product record;
  v_quantity integer;
  v_count integer := 0;
  v_source text;
BEGIN
  IF p_order_type NOT IN ('delivery','dine_in','pickup') THEN
    RAISE EXCEPTION 'نوع الطلب غير مدعوم';
  END IF;
  IF p_payment_method NOT IN ('cash_on_delivery','bank_transfer') THEN
    RAISE EXCEPTION 'طريقة الدفع غير مدعومة';
  END IF;
  IF p_language NOT IN ('ar','en') THEN RAISE EXCEPTION 'اللغة غير مدعومة'; END IF;
  IF p_staff_order IS TRUE AND NOT COALESCE(public.is_admin(), false) THEN
    RAISE EXCEPTION 'غير مصرح بإنشاء طلب موظف';
  END IF;
  IF p_staff_order IS TRUE AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لإنشاء طلب موظف';
  END IF;
  IF p_order_type = 'dine_in' THEN
    IF p_staff_order THEN
      IF p_table_number IS NULL OR p_table_number NOT BETWEEN 1 AND 10 THEN
        RAISE EXCEPTION 'اختر رقم طاولة من 1 إلى 10';
      END IF;
      SELECT t.table_number INTO v_table FROM public.restaurant_tables t
       WHERE t.table_number = p_table_number AND t.is_active = true;
    ELSE
      SELECT t.table_number INTO v_table FROM public.restaurant_tables t
       WHERE t.qr_token = p_table_token AND t.is_active = true;
    END IF;
    IF v_table IS NULL THEN RAISE EXCEPTION 'رمز الطاولة غير صالح أو الطاولة غير مفعلة'; END IF;
  END IF;
  IF COALESCE(length(trim(p_customer_name)),0)=0 AND NOT p_staff_order THEN
    RAISE EXCEPTION 'يرجى إدخال الاسم';
  END IF;
  IF COALESCE(length(trim(p_customer_phone)),0)=0 AND NOT p_staff_order THEN
    RAISE EXCEPTION 'يرجى إدخال رقم الهاتف';
  END IF;
  IF p_order_type = 'delivery' AND COALESCE(length(trim(p_delivery_address)),0)=0 THEN
    RAISE EXCEPTION 'يرجى إدخال عنوان التوصيل';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>50 THEN
    RAISE EXCEPTION 'قائمة المنتجات غير صالحة';
  END IF;
  IF p_order_type = 'delivery' THEN
    SELECT dz.delivery_fee INTO v_delivery_fee FROM public.delivery_zones dz
      WHERE dz.id=p_delivery_zone_id AND dz.is_active=true FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'منطقة التوصيل غير متاحة حاليًا'; END IF;
  ELSE
    v_delivery_fee := 0;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR COALESCE(v_item->>'product_id','')=''
       OR COALESCE(v_item->>'quantity','') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'أحد عناصر الطلب غير صالح';
    END IF;
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity < 1 OR v_quantity > 100 THEN RAISE EXCEPTION 'الكمية يجب أن تكون بين 1 و100'; END IF;
    SELECT p.id,p.name_ar,p.name_en,p.price INTO v_product FROM public.products p
      WHERE p.id=(v_item->>'product_id')::uuid AND p.is_available=true FOR SHARE;
    IF NOT FOUND OR v_product.price IS NULL OR v_product.price < 0 THEN RAISE EXCEPTION 'أحد المنتجات غير متاح'; END IF;
    v_subtotal := v_subtotal + v_product.price*v_quantity;
    v_count := v_count + 1;
  END LOOP;
  IF v_subtotal <= 0 THEN RAISE EXCEPTION 'إجمالي المنتجات غير صالح'; END IF;
  v_total := v_subtotal + v_delivery_fee;
  v_source := CASE WHEN p_staff_order THEN 'staff' WHEN p_order_type='dine_in' THEN 'table_qr' ELSE 'website' END;
  INSERT INTO public.orders (
    customer_name,customer_phone,delivery_address,customer_notes,language,status,
    subtotal,discount_amount,delivery_fee,total,payment_method,payment_status,
    payment_reference,delivery_zone_id,order_type,table_number,order_source
  ) VALUES (
    COALESCE(NULLIF(trim(COALESCE(p_customer_name,'')),''),'طلب داخل المحل'),
    COALESCE(NULLIF(trim(COALESCE(p_customer_phone,'')),''),''),
    CASE WHEN p_order_type='delivery' THEN trim(p_delivery_address)
         WHEN p_order_type='dine_in' THEN 'داخل المحل - طاولة '||v_table
         ELSE 'استلام من المحل' END,
    NULLIF(trim(COALESCE(p_customer_notes,'')),''),p_language,'pending',v_subtotal,0,
    v_delivery_fee,v_total,p_payment_method,
    CASE WHEN p_payment_method='bank_transfer' THEN 'awaiting_transfer' ELSE 'pending' END,
    NULLIF(trim(COALESCE(p_payment_reference,'')),''),
    CASE WHEN p_order_type='delivery' THEN p_delivery_zone_id ELSE NULL END,
    p_order_type,v_table,v_source
  ) RETURNING id,order_number INTO v_order_id,v_order_number;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::integer;
    SELECT p.id,p.name_ar,p.name_en,p.price INTO v_product FROM public.products p
      WHERE p.id=(v_item->>'product_id')::uuid AND p.is_available=true FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'أحد المنتجات لم يعد متاحًا'; END IF;
    INSERT INTO public.order_items(order_id,product_id,product_name_ar,product_name_en,unit_price,quantity,line_total)
    VALUES(v_order_id,v_product.id,v_product.name_ar,v_product.name_en,v_product.price,v_quantity,v_product.price*v_quantity);
  END LOOP;
  RETURN jsonb_build_object('success',true,'order_id',v_order_id,'order_number',v_order_number,
    'subtotal',v_subtotal,'delivery_fee',v_delivery_fee,'total',v_total,'currency','SDG',
    'payment_method',p_payment_method,'payment_status',CASE WHEN p_payment_method='bank_transfer' THEN 'awaiting_transfer' ELSE 'pending' END,
    'order_type',p_order_type,'table_number',v_table,'order_source',v_source);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_customer_order_v2(text,text,text,uuid,text,jsonb,text,text,text,text,text,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order_v2(text,text,text,uuid,text,jsonb,text,text,text,text,text,integer,boolean) TO anon, authenticated;

-- QR links use: https://jsts26.github.io/ayamk-ya-sham/?table=TOKEN
-- To retrieve tokens and build the ten QR images, run the separate admin-only query below after migration:
-- SELECT table_number, table_name, qr_token FROM public.restaurant_tables ORDER BY table_number;
