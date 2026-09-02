-- ============================================================================
-- RMIMS 28 FINISHED PRODUCTS & 59 RAW MATERIALS SITUATIONAL INVENTORY SEEDER
-- Purpose: Realistic operational conditions (Critical, Low, Good) for Reports,
--          Material Activity Logs, and Dashboard Decision Support.
-- ============================================================================

-- 1. Create or ensure finished_goods table exists
CREATE TABLE IF NOT EXISTS public.finished_goods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    unit_of_measure VARCHAR(50) DEFAULT 'packs',
    current_stock NUMERIC DEFAULT 0,
    minimum_threshold NUMERIC DEFAULT 50,
    status VARCHAR(50) DEFAULT 'Good',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Populate the 28 Master Finished Products with Situational Conditions
INSERT INTO public.finished_goods (product_code, name, category, current_stock, minimum_threshold, status)
VALUES
('FG-001', 'Coco Jam', 'Spreads & Jams', 420, 100, 'Good'),
('FG-002', 'Chili Garlic Sauce', 'Condiments & Sauces', 85, 100, 'Low'),
('FG-003', 'Spicy Crunchy Garlic', 'Condiments & Snacks', 210, 80, 'Good'),
('FG-004', 'Cheesy Cassava Chips', 'Chips & Crisps', 35, 80, 'Critical'),
('FG-005', 'Shing-a-ling', 'Fried Snack Delicacies', 540, 120, 'Good'),
('FG-006', 'Sweet Banana Chips', 'Fruit Chips & Sweets', 65, 150, 'Critical'),
('FG-007', 'Salted Banana Chips', 'Fruit Chips & Snacks', 380, 150, 'Good'),
('FG-008', 'Sweet Potato Chips', 'Chips & Crisps', 190, 80, 'Good'),
('FG-009', 'Toasty Biscocho', 'Baked Delicacies', 410, 100, 'Good'),
('FG-010', 'Chiton Seafood Chicharon', 'Seafood Specialties', 28, 60, 'Critical'),
('FG-011', 'Crispy Bite Chicharon', 'Meat Delicacies', 70, 100, 'Low'),
('FG-012', 'Dried Kabasi', 'Dried Seafood', 160, 50, 'Good'),
('FG-013', 'Crispy Bite Ficharon', 'Seafood Specialties', 85, 80, 'Low'),
('FG-014', 'Crispy Pinipig Peanut', 'Nuts & Confections', 310, 90, 'Good'),
('FG-015', 'Fluffy Crumbs Meringue', 'Baked Delicacies', 240, 60, 'Good'),
('FG-016', 'Dried Sapsap', 'Dried Seafood', 195, 50, 'Good'),
('FG-017', 'Pure Ube Halaya', 'Native Kakanin & Sweets', 45, 100, 'Critical'),
('FG-018', 'Atsara', 'Pickled Delicacies', 320, 80, 'Good'),
('FG-019', 'Bukayo Balls', 'Coconut Candies', 280, 70, 'Good'),
('FG-020', 'Ube Balls', 'Native Candies', 190, 60, 'Good'),
('FG-021', 'Apas Bread', 'Biscuits & Wafers', 480, 100, 'Good'),
('FG-022', 'Lengua de Gato', 'Baked Delicacies', 390, 90, 'Good'),
('FG-023', 'Crunchy Peanut Butter', 'Spreads & Jams', 175, 60, 'Good'),
('FG-024', 'Chicharon (Chiton)', 'Seafood Specialties', 32, 60, 'Critical'),
('FG-025', 'Binayong Hipon', 'Seafood Specialties', 140, 50, 'Good'),
('FG-026', 'Biscocho Chips', 'Baked Delicacies', 360, 80, 'Good'),
('FG-027', 'Crispy Bucheron', 'Specialty Snacks', 90, 80, 'Low'),
('FG-028', 'Spicy Dried Fish Snack', 'Dried Seafood', 220, 60, 'Good')
ON CONFLICT (product_code) DO UPDATE SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    current_stock = EXCLUDED.current_stock,
    minimum_threshold = EXCLUDED.minimum_threshold,
    status = EXCLUDED.status;

-- 3. Update 59 Raw Materials with Situational Inventory Balances (Critical, Low, Good)
-- Critical (Red Alert): Stock <= Minimum Threshold
-- Low (Yellow Warning): Stock close to Threshold (<= 1.3x)
-- Good (Green Normal): Healthy Operating Stock (> 1.5x)

INSERT INTO public.raw_materials (item_code, name, category, unit_of_measure, current_stock, minimum_threshold, reorder_quantity, lead_time_days)
VALUES
-- Critical Group (5 SKUs under high demand draw)
('RM-059', 'Refined White Sugar', 'Sweeteners', 'kg', 450.0, 750.0, 1500.0, 3),        -- CRITICAL
('RM-042', 'Unripe Green Saba Bananas', 'Produce / Agricultural', 'kg', 320.0, 450.0, 900.0, 2), -- CRITICAL
('RM-031', 'Fresh Garlic', 'Produce / Agricultural', 'kg', 85.0, 120.0, 240.0, 3),       -- CRITICAL
('RM-023', 'Pork Skin with Back Fat', 'Meat & Poultry', 'kg', 140.0, 200.0, 400.0, 2),    -- CRITICAL
('RM-045', 'Fresh Chiton Mollusk (Kibit)', 'Seafood', 'kg', 35.0, 50.0, 100.0, 2),       -- CRITICAL

-- Low Warning Group (6 SKUs near reorder boundary)
('RM-026', 'Palm Cooking Oil', 'Oils & Fats', 'L', 820.0, 700.0, 1400.0, 3),              -- LOW
('RM-035', 'Fresh Purple Yam Tubers', 'Produce / Agricultural', 'kg', 230.0, 200.0, 400.0, 3), -- LOW
('RM-007', 'Condensed Milk', 'Dairy', 'kg', 170.0, 150.0, 300.0, 3),                     -- LOW
('RM-030', 'Fresh Cassava Tubers', 'Produce / Agricultural', 'kg', 240.0, 200.0, 400.0, 2),-- LOW
('RM-044', 'Fresh Bangus (Milkfish) Skin', 'Seafood', 'kg', 92.0, 80.0, 160.0, 2),        -- LOW
('RM-022', 'Cleaned Chicken Crop (Butse)', 'Meat & Poultry', 'kg', 58.0, 50.0, 100.0, 2), -- LOW

-- Good / Healthy Operating Stock Group (48 SKUs)
('RM-001', 'Food Grade Sunset Yellow / Orange Dye', 'Additives & Colors', 'kg', 50.0, 10.0, 25.0, 5),
('RM-002', 'Baking Powder', 'Baking Supplies', 'kg', 120.0, 25.0, 50.0, 3),
('RM-003', 'Cream of Tartar', 'Baking Supplies', 'kg', 40.0, 10.0, 20.0, 4),
('RM-004', 'Instant Dry Yeast', 'Baking Supplies', 'kg', 85.0, 20.0, 40.0, 3),
('RM-005', 'Cane Vinegar', 'Condiments & Acids', 'L', 350.0, 80.0, 150.0, 4),
('RM-006', 'Soy Sauce', 'Condiments & Acids', 'L', 280.0, 60.0, 120.0, 4),
('RM-008', 'Evaporated Milk', 'Dairy', 'L', 520.0, 120.0, 250.0, 3),
('RM-009', 'Powdered Milk', 'Dairy', 'kg', 800.0, 200.0, 400.0, 4),
('RM-010', 'Fresh Whole Egg Whites', 'Dairy & Eggs', 'kg', 300.0, 75.0, 150.0, 2),
('RM-011', 'Fresh Whole Eggs', 'Dairy & Eggs', 'kg', 950.0, 250.0, 500.0, 2),
('RM-012', 'All-Vegetable Shortening', 'Dairy & Fats', 'kg', 450.0, 100.0, 200.0, 5),
('RM-013', 'Baking Shortening', 'Dairy & Fats', 'kg', 420.0, 100.0, 200.0, 5),
('RM-014', 'Salted Creamery Butter', 'Dairy & Fats', 'kg', 380.0, 90.0, 180.0, 4),
('RM-015', 'Seedless Raisins', 'Dry Goods', 'kg', 180.0, 40.0, 80.0, 7),
('RM-016', 'Vanilla Extract', 'Flavorings & Extracts', 'L', 45.0, 10.0, 20.0, 6),
('RM-017', 'All-Purpose Wheat Flour', 'Grains & Flours', 'kg', 2800.0, 600.0, 1200.0, 3),
('RM-018', 'Cornstarch', 'Grains & Flours', 'kg', 600.0, 150.0, 300.0, 4),
('RM-019', 'Glutinous Rice (Malagkit for Pinipig)', 'Grains & Flours', 'kg', 750.0, 180.0, 350.0, 5),
('RM-020', 'Hard Wheat Bread Flour', 'Grains & Flours', 'kg', 1900.0, 450.0, 900.0, 3),
('RM-021', 'Purified Water', 'Liquids', 'L', 4500.0, 1000.0, 2000.0, 1),
('RM-024', 'Raw Shelled Peanuts', 'Nuts & Seeds', 'kg', 650.0, 150.0, 300.0, 5),
('RM-025', 'Toasted Sesame Seeds', 'Nuts & Seeds', 'kg', 120.0, 30.0, 60.0, 5),
('RM-027', 'Pure Pork Lard', 'Oils & Fats', 'L', 450.0, 100.0, 200.0, 4),
('RM-028', 'Refined Peanut Oil', 'Oils & Fats', 'L', 320.0, 80.0, 150.0, 5),
('RM-029', 'Fresh Carrots', 'Produce / Agricultural', 'kg', 250.0, 60.0, 120.0, 2),
('RM-032', 'Fresh Ginger', 'Produce / Agricultural', 'kg', 210.0, 50.0, 100.0, 3),
('RM-033', 'Fresh Grated Coconut Meat', 'Produce / Agricultural', 'kg', 550.0, 140.0, 280.0, 2),
('RM-034', 'Fresh Mature Coconut Meat', 'Produce / Agricultural', 'kg', 620.0, 150.0, 300.0, 2),
('RM-036', 'Fresh Sweet Potato', 'Produce / Agricultural', 'kg', 420.0, 100.0, 200.0, 3),
('RM-037', 'Green Raw Papaya', 'Produce / Agricultural', 'kg', 380.0, 90.0, 180.0, 2),
('RM-038', 'Pandan Leaves', 'Produce / Agricultural', 'kg', 35.0, 10.0, 20.0, 2),
('RM-039', 'Red Bell Peppers', 'Produce / Agricultural', 'kg', 110.0, 30.0, 60.0, 3),
('RM-040', 'Red Chili Peppers (Siling Labuyo)', 'Produce / Agricultural', 'kg', 65.0, 15.0, 30.0, 2),
('RM-041', 'Red Onions', 'Produce / Agricultural', 'kg', 420.0, 100.0, 200.0, 3),
('RM-043', 'Fresh Acetes Shrimp (Alamang)', 'Seafood', 'kg', 280.0, 70.0, 140.0, 2),
('RM-046', 'Fresh Kabasi Fish', 'Seafood', 'kg', 180.0, 40.0, 80.0, 2),
('RM-047', 'Fresh Sapsap Fish', 'Seafood', 'kg', 220.0, 50.0, 100.0, 2),
('RM-048', 'Cheese Seasoning Powder', 'Seasonings & Powders', 'kg', 140.0, 35.0, 70.0, 5),
('RM-049', 'Coarse Rock Salt', 'Seasonings / Salts', 'kg', 650.0, 150.0, 300.0, 4),
('RM-050', 'Iodized Salt', 'Seasonings / Salts', 'kg', 820.0, 200.0, 400.0, 4),
('RM-051', 'Dried Bay Leaves (Laurel)', 'Spices & Seasonings', 'kg', 25.0, 8.0, 15.0, 7),
('RM-052', 'Dried Red Chili Flakes', 'Spices & Seasonings', 'kg', 45.0, 12.0, 25.0, 6),
('RM-053', 'Garlic Powder', 'Spices & Seasonings', 'kg', 95.0, 25.0, 50.0, 5),
('RM-054', 'Ground Black Pepper', 'Spices & Seasonings', 'kg', 160.0, 40.0, 80.0, 5),
('RM-055', 'White Pepper Powder', 'Spices & Seasonings', 'kg', 75.0, 20.0, 40.0, 5),
('RM-056', 'Whole Black Peppercorns', 'Spices & Seasonings', 'kg', 85.0, 20.0, 40.0, 6),
('RM-057', 'Muscovado Brown Sugar', 'Sweeteners', 'kg', 920.0, 220.0, 450.0, 4),
('RM-058', 'Panutsa Cane Sugar', 'Sweeteners', 'kg', 540.0, 130.0, 260.0, 4)
ON CONFLICT (item_code) DO UPDATE SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    unit_of_measure = EXCLUDED.unit_of_measure,
    current_stock = EXCLUDED.current_stock,
    minimum_threshold = EXCLUDED.minimum_threshold,
    reorder_quantity = EXCLUDED.reorder_quantity,
    lead_time_days = EXCLUDED.lead_time_days;
