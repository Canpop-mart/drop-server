<!-- eslint-disable vue/no-v-html -->
<template>
  <div v-if="game!">
    <div class="grow flex flex-col xl:flex-row gap-y-8">
      <div class="grow w-full h-full px-6 py-4 flex flex-col">
        <div
          class="flex flex-col lg:flex-row lg:justify-between items-start lg:items-center gap-2"
        >
          <div class="inline-flex items-center gap-4">
            <!-- icon image -->
            <img :src="coreMetadataIconUrl" class="size-20" />
            <div>
              <h1
                class="text-2xl xl:text-5xl font-bold font-display text-zinc-100"
              >
                {{ game.mName }}
              </h1>
              <p class="mt-1 text-sm xl:text-lg text-zinc-400">
                {{ game.mShortDescription }}
              </p>
            </div>
          </div>
          <button
            type="button"
            class="relative inline-flex gap-x-3 items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            @click="() => (showEditCoreMetadata = true)"
          >
            {{ $t("common.edit") }} <PencilIcon class="size-4" />
          </button>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-8">
          <SelectorMultiItem
            v-model="currentTags"
            :items="tags"
            :create="createTag"
          />
          <div class="flex flex-col">
            <label
              for="releaseDate"
              class="text-sm/6 font-medium text-zinc-100"
            >
              {{ $t("library.admin.game.editReleaseDate") }}
            </label>
            <div class="mt-2">
              <input
                id="releaseDate"
                v-model="releaseDate"
                type="date"
                name="releaseDate"
                class="block w-full rounded-md bg-zinc-800 px-3 py-1.5 text-base text-zinc-100 outline outline-1 -outline-offset-1 outline-zinc-700 placeholder:text-zinc-400 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-600 sm:text-sm/6"
              />
            </div>
          </div>
        </div>

        <!-- image carousel pick -->
        <div class="border-b border-zinc-700">
          <div class="border-b border-zinc-700 py-4">
            <div
              class="-ml-4 -mt-4 flex flex-wrap items-center justify-between sm:flex-nowrap"
            >
              <div class="ml-4 mt-4">
                <h3 class="text-base font-semibold text-zinc-100">
                  {{ $t("library.admin.game.imageCarousel") }}
                </h3>
                <p class="mt-1 text-sm text-zinc-400 max-w-lg">
                  {{ $t("library.admin.game.imageCarouselDescription") }}
                </p>
              </div>
              <div class="ml-4 mt-4 shrink-0">
                <button
                  type="button"
                  class="relative inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  @click="() => (showAddCarouselModal = true)"
                >
                  {{ $t("library.admin.game.addImageCarousel") }}
                </button>
              </div>
            </div>
          </div>
          <div
            v-if="game.mImageCarouselObjectIds.length == 0"
            class="text-zinc-400 text-center py-8"
          >
            {{ $t("library.admin.game.imageCarouselEmpty") }}
          </div>

          <draggable
            v-else
            :list="game.mImageCarouselObjectIds"
            class="w-full flex flex-row gap-x-4 overflow-x-auto my-2 py-4"
            @update="() => updateImageCarousel()"
          >
            <template #item="{ element }: { element: string }">
              <div class="relative group min-w-fit">
                <img :src="useObject(element)" class="h-48 w-auto" />
                <div
                  class="transition-all lg:opacity-0 lg:group-hover:opacity-100 absolute inset-0 flex flex-col items-center justify-center gap-y-2 bg-zinc-950/50"
                >
                  <button
                    type="button"
                    class="inline-flex items-center gap-x-1.5 rounded-md bg-blue-600 px-1.5 py-0.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-blue-500/25 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    @click="() => removeImageFromCarousel(element)"
                  >
                    {{ $t("library.admin.game.removeImageCarousel") }}
                  </button>
                </div>
              </div>
            </template>
          </draggable>
        </div>

        <!-- description editor -->
        <div
          class="mt-4 grow flex flex-col w-full space-y-4 border border-zinc-800 rounded overflow-hidden p-2"
        >
          <!-- toolbar -->
          <div
            class="h-8 bg-zinc-800 rounded inline-flex gap-x-4 items-center justify-start p-2"
          >
            <div>
              <CheckIcon
                v-if="descriptionSaving == DescriptionSavingState.NotLoading"
                class="size-5 text-zinc-100"
              />
              <div
                v-else-if="descriptionSaving == DescriptionSavingState.Waiting"
              >
                <PencilIcon class="animate-pulse size-5 text-zinc-100" />
              </div>
              <div
                v-else-if="descriptionSaving == DescriptionSavingState.Loading"
                role="status"
              >
                <svg
                  aria-hidden="true"
                  class="w-5 h-5 text-transparent animate-spin fill-white"
                  viewBox="0 0 100 101"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                    fill="currentColor"
                  />
                  <path
                    d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                    fill="currentFill"
                  />
                </svg>
                <span class="sr-only">{{ $t("common.srLoading") }}</span>
              </div>
            </div>

            <button @click="() => (showAddImageDescriptionModal = true)">
              <PhotoIcon
                class="transition size-5 text-zinc-100 hover:text-zinc-300"
              />
            </button>

            <button
              class="block lg:hidden"
              @click="
                () => (mobileShowFinalDescription = !mobileShowFinalDescription)
              "
            >
              <DocumentIcon
                v-if="!mobileShowFinalDescription"
                class="transition size-5 text-zinc-100 hover:text-zinc-300"
              />
              <PencilIcon
                v-else
                class="transition size-5 text-zinc-100 hover:text-zinc-300"
              />
            </button>
          </div>
          <!-- edit area -->
          <div class="grid lg:grid-cols-2 lg:gap-x-8 grow">
            <!-- editing box -->
            <div
              :class="[
                mobileShowFinalDescription ? 'hidden' : 'block',
                'lg:block',
              ]"
            >
              <textarea
                ref="descriptionEditor"
                v-model="game.mDescription"
                class="grow h-full w-full bg-zinc-950/30 text-zinc-100 border-zinc-900 rounded"
              />
            </div>
            <!-- result box -->
            <div
              :class="[
                mobileShowFinalDescription ? 'block' : 'hidden',
                'lg:block prose prose-invert prose-blue bg-zinc-950/30 rounded px-4 py-3',
              ]"
              v-html="descriptionHTML"
            />
          </div>
        </div>
      </div>
      <div
        class="lg:overflow-y-auto lg:border-l lg:border-zinc-800 lg:block lg:inset-y-0 lg:z-50 lg:w-[30vw] flex flex-col gap-y-8 px-6 py-4"
      >
        <!-- image library -->
        <div>
          <div class="border-b border-zinc-800 pb-3">
            <div
              class="flex flex-wrap items-center justify-between sm:flex-nowrap gap-4"
            >
              <div>
                <h3
                  class="text-base font-semibold font-display leading-6 text-zinc-100"
                >
                  {{ $t("library.admin.game.imageLibrary") }}
                </h3>
                <p class="mt-1 text-sm text-zinc-400 max-w-lg">
                  {{ $t("library.admin.game.imageLibraryDescription") }}
                </p>
              </div>
              <div class="flex-shrink-0">
                <button
                  type="button"
                  class="relative inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  @click="() => (showUploadModal = true)"
                >
                  {{ $t("upload") }}
                </button>
              </div>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-2 grid-flow-dense gap-8">
            <div
              v-for="(image, imageIdx) in game.mImageLibraryObjectIds"
              :key="imageIdx"
              class="group relative flex items-center bg-zinc-950/30"
            >
              <img :src="useObject(image)" class="w-full h-auto" />
              <div
                class="transition-all lg:opacity-0 lg:group-hover:opacity-100 absolute inset-0 flex flex-col items-center justify-center gap-y-2 bg-zinc-950/50"
              >
                <button
                  v-if="image !== game.mBannerObjectId"
                  type="button"
                  class="inline-flex items-center gap-x-1.5 rounded-md bg-blue-600 px-1.5 py-0.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-blue-500/25 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  @click="() => updateBannerImage(image)"
                >
                  {{ $t("library.admin.game.setBanner") }}
                </button>
                <button
                  v-if="image !== game.mCoverObjectId"
                  type="button"
                  class="inline-flex items-center gap-x-1.5 rounded-md bg-blue-600 px-1.5 py-0.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-blue-500/25 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  @click="() => updateCoverImage(image)"
                >
                  {{ $t("library.admin.game.setCover") }}
                </button>
                <button
                  v-if="image !== game.mLogoObjectId"
                  type="button"
                  class="inline-flex items-center gap-x-1.5 rounded-md bg-blue-600 px-1.5 py-0.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-blue-500/25 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  @click="() => updateLogoImage(image)"
                >
                  {{ $t("library.admin.game.setLogo") }}
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-x-1.5 rounded-md bg-red-600 px-1.5 py-0.5 text-sm font-semibold text-white shadow-sm hover:bg-red-500 transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-red-500/25 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                  @click="() => deleteImage(image)"
                >
                  {{ $t("library.admin.game.deleteImage") }}
                </button>
              </div>
              <div
                v-if="
                  image === game.mBannerObjectId ||
                  image === game.mCoverObjectId ||
                  image === game.mLogoObjectId
                "
                class="absolute bottom-0 left-0 flex flex-row gap-x-1 p-1"
              >
                <span
                  v-for="[key] of (
                    [
                      [
                        $t('library.admin.game.currentBanner'),
                        image === game.mBannerObjectId,
                      ],
                      [
                        $t('library.admin.game.currentCover'),
                        image === game.mCoverObjectId,
                      ],
                      [
                        $t('library.admin.game.currentLogo'),
                        image === game.mLogoObjectId,
                      ],
                    ] as const
                  ).filter((e) => e[1])"
                  :key="key"
                  class="inline-flex items-center rounded-full bg-blue-900 px-2 py-1 text-xs font-medium text-blue-100"
                  >{{ key }}</span
                >
              </div>
            </div>
          </div>
        </div>

        <!-- RetroAchievements Linking -->
        <div class="mt-8 border-t border-zinc-800 pt-6">
          <div class="border-b border-zinc-800 pb-3">
            <h3
              class="text-base font-semibold font-display leading-6 text-zinc-100"
            >
              RetroAchievements
            </h3>
            <p class="mt-1 text-sm text-zinc-400 max-w-lg">
              Link this game to a RetroAchievements entry to import and sync
              achievements.
            </p>
          </div>

          <div v-if="raLinkedGame" class="mt-3 space-y-3">
            <div
              class="flex items-center gap-3 rounded-lg bg-zinc-800/50 p-3 ring-1 ring-white/5"
            >
              <TrophyIcon class="size-5 text-yellow-500 shrink-0" />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-zinc-100">
                  Linked to RA Game #{{ raLinkedGame.externalGameId }}
                </p>
                <p class="text-xs text-green-400">
                  {{ raLinkedGame.achievementCount }} achievements imported
                </p>
              </div>
            </div>
            <button
              type="button"
              class="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              @click="showRALinkModal = true"
            >
              Re-link to different game
            </button>
          </div>

          <div v-else class="mt-3">
            <button
              type="button"
              class="relative inline-flex items-center gap-x-2 rounded-md bg-yellow-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-yellow-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600"
              @click="showRALinkModal = true"
            >
              <TrophyIcon class="size-4" />
              Link to RetroAchievements
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- RA Link Modal -->
    <ModalTemplate v-model="showRALinkModal">
      <template #default>
        <div class="space-y-4 p-4">
          <p class="text-sm text-zinc-400">
            Search for a game on RetroAchievements by name, or enter an RA game
            ID directly.
          </p>

          <div class="flex gap-2">
            <input
              v-model="raSearchQuery"
              type="text"
              placeholder="Search by name or enter RA ID..."
              class="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
              @keyup.enter="searchRA"
            />
            <button
              type="button"
              :disabled="raSearching || !raSearchQuery"
              class="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              @click="searchRA"
            >
              {{ raSearching ? "Searching..." : "Search" }}
            </button>
          </div>

          <div
            v-if="raSearchResults.length > 0"
            class="max-h-60 overflow-y-auto space-y-1"
          >
            <button
              v-for="result in raSearchResults"
              :key="result.ID"
              :class="[
                'flex items-center justify-between w-full p-2 rounded text-left text-sm transition-colors',
                raSelectedId === result.ID
                  ? 'bg-blue-600/20 ring-1 ring-blue-500'
                  : 'hover:bg-zinc-800',
              ]"
              @click="raSelectedId = result.ID"
            >
              <div class="flex items-center gap-2 min-w-0">
                <img
                  v-if="result.ImageIcon"
                  :src="`https://media.retroachievements.org${result.ImageIcon}`"
                  class="size-8 rounded"
                />
                <div class="min-w-0">
                  <span class="text-zinc-200 truncate block">
                    {{ result.Title }}
                  </span>
                  <span class="text-xs text-zinc-500">
                    {{ result.ConsoleName }}
                  </span>
                </div>
              </div>
              <span class="text-xs text-zinc-400 shrink-0 ml-2">
                {{ result.AchievementCount }} achievements
              </span>
            </button>
          </div>

          <div v-if="raSearchError" class="text-sm text-red-400">
            {{ raSearchError }}
          </div>
        </div>
      </template>
      <template #buttons>
        <LoadingButton
          type="button"
          :loading="raLinkLoading"
          :disabled="!raSelectedId"
          :class="['inline-flex w-full shadow-sm sm:ml-3 sm:w-auto']"
          @click="linkRAGame"
        >
          Link Game
        </LoadingButton>
        <button
          type="button"
          class="mt-3 inline-flex w-full justify-center rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-100 shadow-sm ring-1 ring-inset ring-zinc-700 hover:bg-zinc-950 transition-all duration-200 hover:scale-105 hover:shadow-lg active:scale-95 sm:mt-0 sm:w-auto"
          @click="showRALinkModal = false"
        >
          {{ $t("cancel") }}
        </button>
      </template>
    </ModalTemplate>

    <ModalUploadFile
      v-model="showUploadModal"
      :options="{ id: game.id }"
      accept="image/*"
      endpoint="/api/v1/admin/game/image"
      :multiple="true"
      @upload="(result: GameModel) => uploadAfterImageUpload(result)"
    />
    <ModalTemplate v-model="showAddCarouselModal">
      <template #default>
        <div
          class="grid grid-cols-2 grid-flow-dense gap-4 max-h-[70vh] overflow-y-auto p-4"
        >
          <div
            v-for="(image, imageIdx) in validAddCarouselImages"
            :key="imageIdx"
            class="group relative flex items-center bg-zinc-950/30"
          >
            <img :src="useObject(image)" class="w-full h-auto" />
            <div
              class="transition-all lg:opacity-0 lg:group-hover:opacity-100 absolute inset-0 flex flex-col items-center justify-center gap-y-2 bg-zinc-950/50"
            >
              <button
                type="button"
                class="inline-flex items-center gap-x-1.5 rounded-md bg-blue-600 px-1.5 py-0.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-blue-500/25 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                @click="() => addImageToCarousel(image)"
              >
                {{ $t("add") }}
              </button>
            </div>
          </div>
          <div
            v-if="validAddCarouselImages.length == 0"
            class="text-zinc-400 col-span-2"
          >
            {{ $t("library.admin.game.addCarouselNoImages") }}
          </div>
        </div>
      </template>
      <template #buttons>
        <button
          ref="cancelButtonRef"
          type="button"
          class="mt-3 inline-flex w-full justify-center rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-100 shadow-sm ring-1 ring-inset ring-zinc-700 hover:bg-zinc-950 transition-all duration-200 hover:scale-105 hover:shadow-lg active:scale-95 sm:mt-0 sm:w-auto"
          @click="showAddCarouselModal = false"
        >
          {{ $t("common.close") }}
        </button>
      </template>
    </ModalTemplate>
    <ModalTemplate v-model="showAddImageDescriptionModal">
      <template #default>
        <div class="grid grid-cols-2 grid-flow-dense gap-4">
          <div
            v-for="(image, imageIdx) in game.mImageLibraryObjectIds"
            :key="imageIdx"
            class="group relative flex items-center bg-zinc-950/30"
          >
            <img :src="useObject(image)" class="w-full h-auto" />
            <div
              class="transition-all lg:opacity-0 lg:group-hover:opacity-100 absolute inset-0 flex flex-col items-center justify-center gap-y-2 bg-zinc-950/50"
            >
              <button
                type="button"
                class="inline-flex items-center gap-x-1.5 rounded-md bg-blue-600 px-1.5 py-0.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-blue-500/25 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                @click="() => insertImageAtCursor(image)"
              >
                {{ $t("common.insert") }}
              </button>
            </div>
          </div>
          <div
            v-if="game.mImageLibraryObjectIds.length == 0"
            class="text-zinc-400 col-span-2"
          >
            {{ $t("library.admin.game.addDescriptionNoImages") }}
          </div>
        </div>
      </template>
      <template #buttons>
        <button
          ref="cancelButtonRef"
          type="button"
          class="mt-3 inline-flex w-full justify-center rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-100 shadow-sm ring-1 ring-inset ring-zinc-700 hover:bg-zinc-950 transition-all duration-200 hover:scale-105 hover:shadow-lg active:scale-95 sm:mt-0 sm:w-auto"
          @click="showAddImageDescriptionModal = false"
        >
          {{ $t("cancel") }}
        </button>
      </template>
    </ModalTemplate>
    <ModalTemplate v-model="showEditCoreMetadata">
      <template #default>
        <div class="flex flex-col lg:flex-row gap-6">
          <!-- icon upload div -->
          <div class="flex flex-col items-center gap-4">
            <img :src="coreMetadataIconUrl" class="size-24 aspect-square" />
            <label for="file-upload">
              <span
                type="button"
                class="cursor-pointer relative inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                {{ $t("upload") }}
              </span>
              <input
                id="file-upload"
                accept="image/*"
                class="hidden"
                type="file"
                @change="(e: Event) => coreMetadataUploadFiles(e as any)"
              />
            </label>
          </div>
          <!-- edit title -->
          <div class="flex flex-col gap-y-4 grow">
            <div>
              <label
                for="name"
                class="block text-sm/6 font-medium text-zinc-100"
                >{{ $t("library.admin.game.editGameName") }}</label
              >
              <div class="mt-2">
                <input
                  id="name"
                  v-model="coreMetadataName"
                  type="text"
                  name="name"
                  class="block w-full rounded-md bg-zinc-800 px-3 py-1.5 text-base text-zinc-100 outline outline-1 -outline-offset-1 outline-zinc-700 placeholder:text-zinc-400 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-600 sm:text-sm/6"
                />
              </div>
            </div>
            <div>
              <label
                for="description"
                class="block text-sm/6 font-medium text-zinc-100"
                >{{ $t("library.admin.game.editGameDescription") }}</label
              >
              <div class="mt-2">
                <input
                  id="description"
                  v-model="coreMetadataDescription"
                  type="text"
                  name="description"
                  class="block w-full rounded-md bg-zinc-800 px-3 py-1.5 text-base text-zinc-100 outline outline-1 -outline-offset-1 outline-zinc-700 placeholder:text-zinc-400 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-600 sm:text-sm/6"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #buttons>
        <LoadingButton
          type="button"
          :loading="coreMetadataLoading"
          :class="['inline-flex w-full shadow-sm sm:ml-3 sm:w-auto']"
          @click="() => coreMetadataUpdate_wrapper()"
        >
          {{ $t("common.save") }}
        </LoadingButton>
        <button
          ref="cancelButtonRef"
          type="button"
          class="mt-3 inline-flex w-full justify-center rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-100 shadow-sm ring-1 ring-inset ring-zinc-700 hover:bg-zinc-950 transition-all duration-200 hover:scale-105 hover:shadow-lg active:scale-95 sm:mt-0 sm:w-auto"
          @click="showEditCoreMetadata = false"
        >
          {{ $t("cancel") }}
        </button>
      </template>
    </ModalTemplate>
  </div>
</template>

<script setup lang="ts">
import type { GameModel } from "~/prisma/client/models";
import { micromark } from "micromark";
import {
  CheckIcon,
  DocumentIcon,
  PencilIcon,
  PhotoIcon,
  TrophyIcon,
} from "@heroicons/vue/24/solid";
import type { SerializeObject } from "nitropack";
import type { H3Error } from "h3";
import type { AdminFetchGameType } from "~/server/api/v1/admin/game/[id]/index.get";

const showUploadModal = ref(false);
const showAddCarouselModal = ref(false);
const showAddImageDescriptionModal = ref(false);
const showEditCoreMetadata = ref(false);
const mobileShowFinalDescription = ref(true);

const game = defineModel<SerializeObject<AdminFetchGameType>>({
  required: true,
});
if (!game.value)
  throw createError({
    statusCode: 500,
    statusMessage: "Game not provided to editor component",
  });

const currentTags = ref<{ [key: string]: boolean }>(
  Object.fromEntries(game.value.tags.map((e) => [e.id, true])),
);
const rawTags = await $dropFetch("/api/v1/admin/tags");
const tags = ref(
  rawTags.map((e) => ({ name: e.name, param: e.id }) satisfies StoreSortOption),
);

watch(
  currentTags,
  async (v) => {
    await $dropFetch(`/api/v1/admin/game/:id/tags`, {
      method: "PATCH",
      params: {
        id: game.value.id,
      },
      body: {
        tags: Object.entries(v)
          .filter((v) => v[1])
          .map((v) => v[0]),
      },
      failTitle: "Failed to update game tags",
    });
  },
  { deep: true },
);

const releaseDate = ref(
  game.value.mReleased
    ? new Date(game.value.mReleased).toISOString().substring(0, 10)
    : "",
);

watch(releaseDate, async (newDate) => {
  const body: PatchGameBody = {};

  if (newDate) {
    const parsed = new Date(newDate);
    if (!isNaN(parsed.getTime())) {
      body.mReleased = parsed;
    }
  }

  await $dropFetch(`/api/v1/admin/game/:id`, {
    method: "PATCH",
    params: {
      id: game.value.id,
    },
    body,
    failTitle: "Failed to update release date",
  });
});

const { t } = useI18n();

// I don't know why I split these fields off.
const coreMetadataName = ref(game.value.mName);
const coreMetadataDescription = ref(game.value.mShortDescription);

const coreMetadataIconUrl = ref(useObject(game.value.mIconObjectId));
const coreMetadataIconFileUpload = ref<FileList | undefined>();
const coreMetadataLoading = ref(false);

function coreMetadataUploadFiles(e: InputEvent) {
  if (coreMetadataIconUrl.value.startsWith("blob")) {
    URL.revokeObjectURL(coreMetadataIconUrl.value);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  coreMetadataIconFileUpload.value = (e.target as any)?.files;
  const file = coreMetadataIconFileUpload.value?.item(0);
  if (!file) {
    createModal(
      ModalType.Notification,
      {
        title: t("errors.upload.title"),
        description: t("errors.upload.description", [t("errors.unknown")]),
        buttonText: t("common.close"),
      },
      (e, c) => c(),
    );
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  coreMetadataIconUrl.value = objectUrl;
}
async function coreMetadataUpdate() {
  const formData = new FormData();

  const newIcon = coreMetadataIconFileUpload.value?.item(0);
  if (newIcon) {
    formData.append("icon", newIcon);
  }

  formData.append("name", coreMetadataName.value);
  formData.append("description", coreMetadataDescription.value);

  const result = await $dropFetch(
    `/api/v1/admin/game/${game.value.id}/metadata`,
    {
      method: "POST",
      body: formData,
    },
  );
  return result;
}

function coreMetadataUpdate_wrapper() {
  coreMetadataLoading.value = true;
  coreMetadataUpdate()
    .catch((e) => {
      createModal(
        ModalType.Notification,
        {
          title: t("errors.game.metadata.title"),
          description: t("errors.game.metadata.description", [
            (e as H3Error)?.statusMessage ?? t("errors.unknown"),
          ]),
          buttonText: t("common.close"),
        },
        (e, c) => c(),
      );
    })
    .then((newGame) => {
      if (!newGame) return;
      Object.assign(game.value, newGame);
      coreMetadataIconUrl.value = useObject(newGame.mIconObjectId);
    })
    .finally(() => {
      coreMetadataLoading.value = false;
      showEditCoreMetadata.value = false;
    });
}

const descriptionHTML = computed(() =>
  micromark(game.value?.mDescription ?? ""),
);
const descriptionEditor = ref<HTMLTextAreaElement | undefined>();
// 0 is not loading
// 1 is waiting for stop
// 2 is loading
enum DescriptionSavingState {
  NotLoading,
  Waiting,
  Loading,
}
const descriptionSaving = ref<DescriptionSavingState>(
  DescriptionSavingState.NotLoading,
);

let savingTimeout: undefined | NodeJS.Timeout;

type PatchGameBody = Partial<GameModel>;

watch(descriptionHTML, (_v) => {
  descriptionSaving.value = DescriptionSavingState.Waiting;
  if (savingTimeout) clearTimeout(savingTimeout);
  savingTimeout = setTimeout(async () => {
    try {
      descriptionSaving.value = DescriptionSavingState.Loading;
      await $dropFetch(`/api/v1/admin/game/:id`, {
        method: "PATCH",
        params: {
          id: game.value.id,
        },
        body: {
          mDescription: game.value.mDescription,
        } satisfies PatchGameBody,
      });
      descriptionSaving.value = DescriptionSavingState.NotLoading;
    } catch (e) {
      createModal(
        ModalType.Notification,
        {
          title: t("errors.game.description.title"),
          description: t("errors.game.description.description", [
            (e as H3Error)?.statusMessage ?? t("errors.unknown"),
          ]),
          buttonText: t("common.close"),
        },
        (e, c) => c(),
      );
    }
  }, 1500);
});

const validAddCarouselImages = computed(() =>
  game.value.mImageLibraryObjectIds.filter(
    (e) =>
      !game.value.mImageCarouselObjectIds.includes(e) &&
      e !== game.value.mBannerObjectId &&
      e !== game.value.mCoverObjectId,
  ),
);

function insertImageAtCursor(id: string) {
  showAddImageDescriptionModal.value = false;
  if (!descriptionEditor.value || !game.value) return;
  const insertPosition = descriptionEditor.value.selectionStart;
  const text = `![](/api/v1/object/${id})`;
  game.value.mDescription = `${game.value.mDescription.slice(
    0,
    insertPosition,
  )}${text}${game.value.mDescription.slice(insertPosition)}`;
}

async function updateBannerImage(id: string) {
  try {
    if (game.value.mBannerObjectId == id) return;
    const { mBannerObjectId } = await $dropFetch(`/api/v1/admin/game/:id`, {
      method: "PATCH",
      params: {
        id: game.value.id,
      },
      body: {
        mBannerObjectId: id,
      } satisfies PatchGameBody,
    });
    game.value.mBannerObjectId = mBannerObjectId;
  } catch (e) {
    createModal(
      ModalType.Notification,
      {
        title: t("errors.game.banner.title"),
        description: t("errors.game.banner.description", [
          (e as H3Error)?.statusMessage ?? t("errors.unknown"),
        ]),
        buttonText: t("common.close"),
      },
      (e, c) => c(),
    );
  }
}

async function updateCoverImage(id: string) {
  try {
    if (game.value.mCoverObjectId == id) return;
    const { mCoverObjectId } = await $dropFetch(`/api/v1/admin/game/:id`, {
      method: "PATCH",
      params: {
        id: game.value.id,
      },
      body: {
        mCoverObjectId: id,
      } satisfies PatchGameBody,
    });
    game.value.mCoverObjectId = mCoverObjectId;
  } catch (e) {
    createModal(
      ModalType.Notification,
      {
        title: t("errors.game.cover.title"),
        description: t("errors.game.cover.description", [
          (e as H3Error)?.statusMessage ?? t("errors.unknown"),
        ]),
        buttonText: t("common.close"),
      },
      (e, c) => c(),
    );
  }
}

async function updateLogoImage(id: string) {
  try {
    if (game.value.mLogoObjectId == id) return;
    const { mLogoObjectId } = await $dropFetch(`/api/v1/admin/game/:id`, {
      method: "PATCH",
      params: {
        id: game.value.id,
      },
      body: {
        mLogoObjectId: id,
      } satisfies PatchGameBody,
    });
    game.value.mLogoObjectId = mLogoObjectId;
  } catch (e) {
    createModal(
      ModalType.Notification,
      {
        title: t("errors.game.logo.title"),
        description: t("errors.game.logo.description", [
          (e as H3Error)?.statusMessage ?? t("errors.unknown"),
        ]),
        buttonText: t("common.close"),
      },
      (e, c) => c(),
    );
  }
}

async function deleteImage(id: string) {
  try {
    const { mBannerObjectId, mImageLibraryObjectIds } = await $dropFetch(
      "/api/v1/admin/game/image",
      {
        method: "DELETE",
        body: {
          gameId: game.value.id,
          imageId: id,
        },
      },
    );
    game.value.mImageLibraryObjectIds = mImageLibraryObjectIds;
    game.value.mBannerObjectId = mBannerObjectId;
  } catch (e) {
    createModal(
      ModalType.Notification,
      {
        title: t("errors.game.deleteImage.title"),
        description: t("errors.game.deleteImage.description", [
          (e as H3Error)?.statusMessage ?? t("errors.unknown"),
        ]),
        buttonText: t("common.close"),
      },
      (e, c) => c(),
    );
  }
}

async function uploadAfterImageUpload(result: GameModel) {
  if (!game.value) return;
  game.value.mImageLibraryObjectIds = result.mImageLibraryObjectIds;
}

function addImageToCarousel(id: string) {
  game.value.mImageCarouselObjectIds.push(id);
  updateImageCarousel();
}

function removeImageFromCarousel(id: string) {
  const imageIndex = game.value.mImageCarouselObjectIds.findIndex(
    (e) => e == id,
  );
  game.value.mImageCarouselObjectIds.splice(imageIndex, 1);
  updateImageCarousel();
}

async function updateImageCarousel() {
  try {
    await $dropFetch(`/api/v1/admin/game/:id`, {
      method: "PATCH",
      params: {
        id: game.value.id,
      },
      body: {
        mImageCarouselObjectIds: game.value.mImageCarouselObjectIds,
      } satisfies PatchGameBody,
    });
  } catch (e) {
    createModal(
      ModalType.Notification,
      {
        title: t("errors.game.carousel.title"),
        description: t("errors.game.carousel.description", [
          (e as H3Error)?.statusMessage ?? t("errors.unknown"),
        ]),
        buttonText: t("common.close"),
      },
      (e, c) => c(),
    );
  }
}

async function createTag(value: string): Promise<string> {
  const tag = await $dropFetch(`/api/v1/admin/tags`, {
    method: "POST",
    body: {
      name: value,
    },
  });
  tags.value.push({ name: tag.name, param: tag.id });
  return tag.id;
}

// ── RetroAchievements Linking ─────────────────────────────────────────────

type RALinkedGame = {
  externalGameId: string;
  achievementCount: number;
};

type RASearchResult = {
  ID: number;
  Title: string;
  ConsoleName: string;
  ImageIcon: string;
  AchievementCount: number;
};

const showRALinkModal = ref(false);
const raLinkedGame = ref<RALinkedGame | null>(null);
const raSearchQuery = ref("");
const raSearchResults = ref<RASearchResult[]>([]);
const raSelectedId = ref<number | null>(null);
const raSearching = ref(false);
const raLinkLoading = ref(false);
const raSearchError = ref("");

// Check if game is already linked to RA
try {
  const links = await $dropFetch<
    Array<{ provider: string; externalGameId: string }>
  >(`/api/v1/admin/game/${game.value.id}/external-links`).catch(() => []);
  const raLink = links?.find((l) => l.provider === "RetroAchievements");
  if (raLink) {
    // Count achievements for this game from RA provider
    const achievements = await $dropFetch<Array<{ id: string }>>(
      `/api/v1/games/${game.value.id}/achievements`,
    ).catch(() => []);
    raLinkedGame.value = {
      externalGameId: raLink.externalGameId,
      achievementCount: achievements?.length ?? 0,
    };
  }
} catch {
  // ignore
}

async function searchRA() {
  if (!raSearchQuery.value) return;
  raSearching.value = true;
  raSearchError.value = "";
  raSearchResults.value = [];
  raSelectedId.value = null;

  try {
    // Check if input is a number (direct RA game ID)
    const asNum = parseInt(raSearchQuery.value, 10);
    if (!isNaN(asNum) && String(asNum) === raSearchQuery.value.trim()) {
      raSelectedId.value = asNum;
      raSearchResults.value = [
        {
          ID: asNum,
          Title: `RA Game #${asNum}`,
          ConsoleName: "Direct ID",
          ImageIcon: "",
          AchievementCount: 0,
        },
      ];
      return;
    }

    const results = await $dropFetch<RASearchResult[]>(
      `/api/v1/admin/retroachievements/search`,
      { query: { q: raSearchQuery.value } },
    );
    raSearchResults.value = results ?? [];
    if (raSearchResults.value.length === 0) {
      raSearchError.value = "No games found on RetroAchievements.";
    }
  } catch (err: unknown) {
    raSearchError.value =
      err && typeof err === "object" && "statusMessage" in err
        ? String((err as { statusMessage: string }).statusMessage)
        : "Search failed";
  } finally {
    raSearching.value = false;
  }
}

async function linkRAGame() {
  if (!raSelectedId.value) return;
  raLinkLoading.value = true;
  raSearchError.value = "";

  try {
    const result = await $dropFetch<{
      achievementCount: number;
      raGameId: number;
    }>(`/api/v1/admin/game/${game.value.id}/link-retroachievements`, {
      method: "POST",
      body: { raGameId: raSelectedId.value },
    });
    raLinkedGame.value = {
      externalGameId: String(result.raGameId),
      achievementCount: result.achievementCount,
    };
    showRALinkModal.value = false;
    raSearchQuery.value = "";
    raSearchResults.value = [];
    raSelectedId.value = null;
  } catch (err: unknown) {
    raSearchError.value =
      err && typeof err === "object" && "statusMessage" in err
        ? String((err as { statusMessage: string }).statusMessage)
        : "Failed to link game";
  } finally {
    raLinkLoading.value = false;
  }
}
</script>
