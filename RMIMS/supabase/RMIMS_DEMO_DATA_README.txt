RMIMS DEMO DATA — WHAT WAS PREPARED

1. Finished products
   - Kibets
   - Binayong Hipon
   - Biscocho Chips
   - Crispy Bucheron
   - Salted Banana Chips
   - Creamy Peanut Butter
   - Crunchy Peanut Butter

2. Raw materials
   28 thesis-aligned raw materials with category, unit, current stock,
   minimum threshold, supplier text, storage location, and status.

3. Product-material requirements
   45 product/material relationships. Several materials are shared
   across multiple finished products to make consumption analytics
   more meaningful.

4. Historical consumption
   8,415 synthetic product-linked usage rows covering weekly dates
   from 2023-01-01 through 2026-07-26. Multiple products can consume
   the same material on the same date; the Python API aggregates
   material/date usage before forecasting.

5. Important
   The historical quantities, stock quantities, suppliers, and
   recipe quantities are synthetic demo/test values. They were
   created from the product/raw-material list in the thesis and are
   not claims about actual business records.

6. How to use
   Run RMIMS_DEMO_DATA_SEED.sql in the Supabase SQL Editor after the
   required RMIMS schema/migrations are installed.