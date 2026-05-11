import {
  getPinnedItemsService,
  pinItemsService,
  unpinItemsService,
  updatePinnedItemOrderService,
} from '../services/pinnedService.js';

export const pinnedController = {
  async getPinnedItems(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;
      const pinnedItems = await getPinnedItemsService(userId, tenantIds);
      res.json(pinnedItems);
    } catch (error) {
      console.error('Error in getPinnedItems:', error);
      res.status(500).json({ error: 'Failed to fetch pinned items' });
    }
  },

  async pinItems(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;
      const { items } = req.body;

      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Items must be an array' });
      }

      const result = await pinItemsService(items, userId, tenantIds);
      res.status(201).json(result);
    } catch (error) {
      console.error('Error in pinItems:', error);
      res.status(500).json({ error: 'Failed to pin items' });
    }
  },

  async unpinItems(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const { itemIds } = req.body;

      if (!Array.isArray(itemIds)) {
        return res.status(400).json({ error: 'ItemIds must be an array' });
      }

      const result = await unpinItemsService(itemIds, userId);
      res.json(result);
    } catch (error) {
      console.error('Error in unpinItems:', error);
      res.status(500).json({ error: 'Failed to unpin items' });
    }
  },

  async updatePinnedItemOrder(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const { itemId } = req.params;
      const { orderPosition } = req.body;

      if (typeof orderPosition !== 'number') {
        return res
          .status(400)
          .json({ error: 'Order position must be a number' });
      }

      const result = await updatePinnedItemOrderService(
        itemId,
        orderPosition,
        userId
      );
      res.json(result);
    } catch (error) {
      console.error('Error in updatePinnedItemOrder:', error);
      res.status(500).json({ error: 'Failed to update pinned item order' });
    }
  },
};
