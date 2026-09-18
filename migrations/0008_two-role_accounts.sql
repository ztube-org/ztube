-- ZTube now has two account roles: one configured Admin and persisted Children.
DROP INDEX `children_parent_id_idx`;
ALTER TABLE `children` DROP COLUMN `parent_id`;
DROP TABLE `parents`;
