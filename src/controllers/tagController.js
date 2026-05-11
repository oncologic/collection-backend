import {
  getAllTagsService,
  createTagService,
  updateTagService,
  deleteTagService,
} from '../services/tagService.js';

export const getAllTags = async (req, res) => {
  try {
    const tenantIds = req.tenantIds;
    const userId = req.auth?.dbUserId;
    const tags = await getAllTagsService(tenantIds, userId);
    res.json(tags);
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({
      error: 'Failed to fetch tags',
      message: error.message,
    });
  }
};

export const createTag = async (req, res) => {
  try {
    const tenantIds = req.tenantIds;
    const userId = req.auth?.dbUserId;
    const tagData = req.body;
    const newTag = await createTagService(tagData, tenantIds, userId);
    res.status(201).json(newTag);
  } catch (error) {
    console.error('Error creating tag:', error);
    res.status(500).json({
      error: 'Failed to create tag',
      message: error.message,
    });
  }
};

export const updateTag = async (req, res) => {
  try {
    const { id } = req.params;
    const tenantIds = req.tenantIds;
    const tagData = req.body;
    const updatedTag = await updateTagService(id, tagData, tenantIds);
    res.json(updatedTag);
  } catch (error) {
    console.error('Error updating tag:', error);
    res.status(500).json({
      error: 'Failed to update tag',
      message: error.message,
    });
  }
};

export const deleteTag = async (req, res) => {
  try {
    const { id } = req.params;
    const tenantIds = req.tenantIds;
    await deleteTagService(id, tenantIds);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting tag:', error);
    res.status(500).json({
      error: 'Failed to delete tag',
      message: error.message,
    });
  }
};
