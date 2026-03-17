ALTER TABLE categories ADD COLUMN parent_id INTEGER;
ALTER TABLE categories ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_parent ON categories(name, parent_id);

UPDATE categories
SET level = 1,
    sort_order = CASE WHEN sort_order = 0 THEN id ELSE sort_order END,
    is_active = 1
WHERE level IS NULL OR level = 0;

INSERT OR IGNORE INTO categories (name, parent_id, level, sort_order, is_active) VALUES ('Vehicle', NULL, 1, 10, 1);
INSERT OR IGNORE INTO categories (name, parent_id, level, sort_order, is_active) VALUES ('Tools', NULL, 1, 20, 1);
INSERT OR IGNORE INTO categories (name, parent_id, level, sort_order, is_active) VALUES ('Consumables', NULL, 1, 30, 1);

INSERT OR IGNORE INTO categories (name, parent_id, level, sort_order, is_active)
SELECT 'Engine', c.id, 2, 10, 1 FROM categories c WHERE c.name = 'Vehicle' AND c.parent_id IS NULL;
INSERT OR IGNORE INTO categories (name, parent_id, level, sort_order, is_active)
SELECT 'Body', c.id, 2, 20, 1 FROM categories c WHERE c.name = 'Vehicle' AND c.parent_id IS NULL;
INSERT OR IGNORE INTO categories (name, parent_id, level, sort_order, is_active)
SELECT 'Hand Tools', c.id, 2, 10, 1 FROM categories c WHERE c.name = 'Tools' AND c.parent_id IS NULL;
INSERT OR IGNORE INTO categories (name, parent_id, level, sort_order, is_active)
SELECT 'Power Tools', c.id, 2, 20, 1 FROM categories c WHERE c.name = 'Tools' AND c.parent_id IS NULL;

INSERT OR IGNORE INTO categories (name, parent_id, level, sort_order, is_active)
SELECT 'Oil Filter', c.id, 3, 10, 1 FROM categories c WHERE c.name = 'Engine' AND c.level = 2;
INSERT OR IGNORE INTO categories (name, parent_id, level, sort_order, is_active)
SELECT 'Bumper Repair', c.id, 3, 20, 1 FROM categories c WHERE c.name = 'Body' AND c.level = 2;
INSERT OR IGNORE INTO categories (name, parent_id, level, sort_order, is_active)
SELECT 'Wrench Set', c.id, 3, 10, 1 FROM categories c WHERE c.name = 'Hand Tools' AND c.level = 2;
INSERT OR IGNORE INTO categories (name, parent_id, level, sort_order, is_active)
SELECT 'Impact Driver Bit', c.id, 3, 20, 1 FROM categories c WHERE c.name = 'Power Tools' AND c.level = 2;
