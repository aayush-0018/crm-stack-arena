-- 022_gst.sql — GST rate per product, copied onto each order line when it is sold.
-- Selling prices include GST: totals never change; the GST inside each sale is worked out from them.
-- NULL = no rate set (free-text lines, or products not yet given a rate). Additive only.
ALTER TABLE products    ADD COLUMN gst_rate NUMERIC(5,2) CHECK (gst_rate >= 0 AND gst_rate <= 40);
ALTER TABLE order_items ADD COLUMN gst_rate NUMERIC(5,2) CHECK (gst_rate >= 0 AND gst_rate <= 40);
