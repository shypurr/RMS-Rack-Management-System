import { Router } from 'express';
import { getLayout, previewLayout, applyLayout } from '../services/layoutService.js';
import { requireLayoutPermission } from '../middleware/requireLayoutPermission.js';

const router = Router();

// GET /api/layout — what this org's rack space looks like, and whether it has
// one at all. The client gates Add Item / Move / Picklist on `configured`.
router.get('/', async (req, res, next) => {
  try {
    res.json(await getLayout(req.org.id));
  } catch (err) { next(err); }
});

// POST /api/layout/preview — the first of the two gates. Computes what would
// change and what stands in the way. Writes nothing, ever.
router.post('/preview', requireLayoutPermission, async (req, res, next) => {
  try {
    const { racks, shelves, bins, bin_capacity, overrides = [] } = req.body || {};
    res.json(await previewLayout(req.org.id, { racks, shelves, bins, bin_capacity, overrides }));
  } catch (err) { next(err); }
});

// POST /api/layout/apply — the second gate. The client sends this only after
// the user has seen the preview counts and said yes. `version` comes from the
// preview and is rejected if the layout moved underneath it.
router.post('/apply', requireLayoutPermission, async (req, res, next) => {
  try {
    const { racks, shelves, bins, bin_capacity, overrides = [], version } = req.body || {};
    const result = await applyLayout(req.org.id, {
      racks, shelves, bins, bin_capacity, overrides, version,
      userId: req.org.vastra_org_id,
    });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
