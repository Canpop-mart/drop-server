-- Curated store collections: a cover image, description, store-shelf ordering,
-- and an admin-gated `featured` flag (a collection surfaces on the store when
-- isPublic && featured). Plus per-entry ordering for the landing page. All
-- default to "off"/0 so existing personal collections are unaffected.
ALTER TABLE "Collection"
    ADD COLUMN "description" TEXT,
    ADD COLUMN "coverObjectId" TEXT,
    ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "sortIndex" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CollectionEntry"
    ADD COLUMN "sortIndex" INTEGER NOT NULL DEFAULT 0;
