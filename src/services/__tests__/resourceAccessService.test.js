import {
  filterResourceChildItemsByVisibility,
  getAllowedResourceChildVisibilities,
  RESOURCE_ACCESS_MODES,
} from '../resourceAccessService.js';

describe('resourceAccessService', () => {
  const childItems = [
    {
      id: 'public-child',
      visibility: 'public',
      userId: 'child-owner',
    },
    {
      id: 'unlisted-child',
      visibility: 'unlisted',
      userId: 'child-owner',
    },
    {
      id: 'private-child',
      visibility: 'private',
      userId: 'child-owner',
    },
  ];

  it('allows owners to see private resource child content in authenticated mode', () => {
    expect(
      getAllowedResourceChildVisibilities({
        accessMode: RESOURCE_ACCESS_MODES.AUTHENTICATED,
        parentOwnerId: 'parent-owner',
        childOwnerId: 'child-owner',
        viewerUserId: 'parent-owner',
      })
    ).toEqual(['public', 'unlisted', 'private']);

    expect(
      filterResourceChildItemsByVisibility(childItems, {
        accessMode: RESOURCE_ACCESS_MODES.AUTHENTICATED,
        parentOwnerId: 'parent-owner',
        viewerUserId: 'parent-owner',
      }).map((item) => item.id)
    ).toEqual(['public-child', 'unlisted-child', 'private-child']);
  });

  it('limits authenticated non-owners to public and unlisted child content', () => {
    expect(
      filterResourceChildItemsByVisibility(childItems, {
        accessMode: RESOURCE_ACCESS_MODES.AUTHENTICATED,
        parentOwnerId: 'parent-owner',
        viewerUserId: 'other-user',
      }).map((item) => item.id)
    ).toEqual(['public-child', 'unlisted-child']);
  });

  it('limits shared access to public and unlisted child content', () => {
    expect(
      filterResourceChildItemsByVisibility(childItems, {
        accessMode: RESOURCE_ACCESS_MODES.SHARED,
        parentOwnerId: 'parent-owner',
        viewerUserId: null,
      }).map((item) => item.id)
    ).toEqual(['public-child', 'unlisted-child']);
  });

  it('limits public access to public child content only', () => {
    expect(
      filterResourceChildItemsByVisibility(childItems, {
        accessMode: RESOURCE_ACCESS_MODES.PUBLIC,
        parentOwnerId: 'parent-owner',
        viewerUserId: null,
      }).map((item) => item.id)
    ).toEqual(['public-child']);
  });
});
