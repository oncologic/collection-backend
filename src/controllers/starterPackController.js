import {
  getAllStarterPacksService,
  getStarterPackByIdService,
  createStarterPackService,
  updateStarterPackService,
  deleteStarterPackService,
} from '../services/starterPackService.js';

export const getAllStarterPacks = async (req, res) => {
  try {
    const starterPacks = await getAllStarterPacksService();
    res.json(starterPacks);
  } catch (error) {
    console.error('Error fetching starter packs:', error);
    res.status(500).json({
      error: 'Failed to fetch starter packs',
      message: error.message,
    });
  }
};

export const getStarterPackById = async (req, res) => {
  try {
    const starterPack = await getStarterPackByIdService(req.params.id);
    if (!starterPack) {
      return res.status(404).json({ error: 'Starter pack not found' });
    }
    res.json(starterPack);
  } catch (error) {
    console.error('Error fetching starter pack:', error);
    res.status(500).json({
      error: 'Failed to fetch starter pack',
      message: error.message,
    });
  }
};

export const createStarterPack = async (req, res) => {
  try {
    const { name, description, type, items } = req.body;
    const userId = req.auth.dbUserId;

    // Group items by their type (collection, event, resource)
    const groupedItems = {
      collections: items.filter((item) => item.type === 'collection'),
      events: items.filter((item) => item.type === 'event'),
      resources: items.filter((item) => item.type === 'resource'),
    };

    const newStarterPack = await createStarterPackService({
      name,
      description,
      type,
      userId,
      groupedItems,
    });
    res.status(201).json(newStarterPack);
  } catch (error) {
    console.error('Error creating starter pack:', error);
    res.status(500).json({
      error: 'Failed to create starter pack',
      message: error.message,
    });
  }
};

export const updateStarterPack = async (req, res) => {
  try {
    const { name, description, type, items } = req.body;
    const id = req.params.id;
    const userId = req.auth.dbUserId;

    const updatedStarterPack = await updateStarterPackService({
      id,
      name,
      description,
      type,
      userId,
      items,
    });

    if (!updatedStarterPack) {
      return res.status(404).json({ error: 'Starter pack not found' });
    }

    res.json(updatedStarterPack);
  } catch (error) {
    console.error('Error updating starter pack:', error);
    res.status(500).json({
      error: 'Failed to update starter pack',
      message: error.message,
    });
  }
};

export const deleteStarterPack = async (req, res) => {
  try {
    const id = req.params.id;
    const userId = req.auth.dbUserId;

    const deleted = await deleteStarterPackService(id, userId);
    if (!deleted) {
      return res.status(404).json({ error: 'Starter pack not found' });
    }

    res.json({ message: 'Starter pack deleted successfully' });
  } catch (error) {
    console.error('Error deleting starter pack:', error);
    res.status(500).json({
      error: 'Failed to delete starter pack',
      message: error.message,
    });
  }
};
