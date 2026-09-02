import { Router } from 'express';
import { getLayout, addRacks } from '../services/layoutService.js';
import { requireLayoutPermission } from '../middleware/requireLayoutPermission.js';

const router = Router();

// GET /api/layout — what this org's rack space looks like, and whether it has
// one at all. The client gates Add Item / Move / Picklist on `configured`.
router.get('/', async (req, res, next) => {
  try {
    res.json(await getLayout(req.org.id));
  } catch (err) { next(err); }
});

// POST /api/layout/racks — add one batch of racks, appended after the ones this
// organization already has. This is the ONLY route that changes the layout.
//
// It replaced POST /preview and POST /apply, which took a whole desired layout
// and diffed it against reality. That pair could delete racks — it was the only
// thing standing between a mistyped "5" where "50" belonged and a deleted
// warehouse, guarded by a preview screen the user had to read. Removing racks
// is now its own flow with its own rules, so this route does not express
// deletion at all and no amount of bad input makes it destructive.
router.post('/racks', requireLayoutPermission, async (req, res, next) => {
  try {
    const { racks, shelves, bins, bin_capacity } = req.body || {};
    res.json(await addRacks(req.org.id, {
      racks, shelves, bins, bin_capacity, userId: req.org.vastra_org_id,
    }));
  } catch (err) { next(err); }
});

export default router;
