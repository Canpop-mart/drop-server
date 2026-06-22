-- CreateIndex
CREATE INDEX "Client_lastConnected_idx" ON "Client"("lastConnected" DESC);

-- CreateIndex
CREATE INDEX "UnimportedGameVersion_gameId_idx" ON "UnimportedGameVersion"("gameId");
