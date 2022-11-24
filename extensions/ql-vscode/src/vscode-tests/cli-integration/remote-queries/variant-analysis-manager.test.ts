import {
  CancellationTokenSource,
  commands,
  env,
  extensions,
  QuickPickItem,
  Uri,
  window,
} from "vscode";
import { CodeQLExtensionInterface } from "../../../extension";
import { logger } from "../../../logging";
import * as config from "../../../config";
import {
  setRemoteControllerRepo,
  setRemoteRepositoryLists,
} from "../../../config";
import * as ghApiClient from "../../../remote-queries/gh-api/gh-api-client";
import * as ghActionsApiClient from "../../../remote-queries/gh-api/gh-actions-api-client";
import { Credentials } from "../../../authentication";
import * as fs from "fs-extra";
import * as path from "path";

import { VariantAnalysisManager } from "../../../remote-queries/variant-analysis-manager";
import { CodeQLCliServer } from "../../../cli";
import {
  fixWorkspaceReferences,
  restoreWorkspaceReferences,
  storagePath,
} from "../global.helper";
import { VariantAnalysisResultsManager } from "../../../remote-queries/variant-analysis-results-manager";
import { createMockVariantAnalysis } from "../../factories/remote-queries/shared/variant-analysis";
import * as VariantAnalysisModule from "../../../remote-queries/shared/variant-analysis";
import {
  createMockScannedRepo,
  createMockScannedRepos,
} from "../../factories/remote-queries/shared/scanned-repositories";
import {
  VariantAnalysis,
  VariantAnalysisScannedRepository,
  VariantAnalysisScannedRepositoryDownloadStatus,
  VariantAnalysisStatus,
} from "../../../remote-queries/shared/variant-analysis";
import { createTimestampFile } from "../../../helpers";
import { createMockVariantAnalysisRepoTask } from "../../factories/remote-queries/gh-api/variant-analysis-repo-task";
import {
  VariantAnalysis as VariantAnalysisApiResponse,
  VariantAnalysisRepoTask,
} from "../../../remote-queries/gh-api/variant-analysis";
import { createMockApiResponse } from "../../factories/remote-queries/gh-api/variant-analysis-api-response";
import { UserCancellationException } from "../../../commandRunner";
import { Repository } from "../../../remote-queries/gh-api/repository";
import {
  defaultFilterSortState,
  SortKey,
} from "../../../pure/variant-analysis-filter-sort";

// up to 3 minutes per test
jest.setTimeout(3 * 60 * 1000);

describe("Variant Analysis Manager", () => {
  const pathExistsStub = jest.spyOn(fs, "pathExists");
  const readJsonStub = jest.spyOn(fs, "readJson");
  const outputJsonStub = jest.spyOn(fs, "outputJson");
  const writeFileStub = jest.spyOn(fs, "writeFile");
  let cli: CodeQLCliServer;
  let cancellationTokenSource: CancellationTokenSource;
  let variantAnalysisManager: VariantAnalysisManager;
  let variantAnalysisResultsManager: VariantAnalysisResultsManager;
  let variantAnalysis: VariantAnalysis;
  let scannedRepos: VariantAnalysisScannedRepository[];

  beforeEach(async () => {
    jest.spyOn(logger, "log").mockResolvedValue(undefined);
    jest
      .spyOn(config, "isVariantAnalysisLiveResultsEnabled")
      .mockReturnValue(false);
    jest.spyOn(fs, "mkdirSync").mockReturnValue(undefined);
    writeFileStub.mockReturnValue(undefined);
    pathExistsStub.mockRestore();
    readJsonStub.mockRestore();
    outputJsonStub.mockReturnValue(undefined);

    cancellationTokenSource = new CancellationTokenSource();

    scannedRepos = createMockScannedRepos();
    variantAnalysis = createMockVariantAnalysis({
      status: VariantAnalysisStatus.InProgress,
      scannedRepos,
    });

    const extension = await extensions
      .getExtension<CodeQLExtensionInterface | Record<string, never>>(
        "GitHub.vscode-codeql",
      )!
      .activate();
    cli = extension.cliServer;
    variantAnalysisResultsManager = new VariantAnalysisResultsManager(
      cli,
      logger,
    );
    variantAnalysisManager = new VariantAnalysisManager(
      extension.ctx,
      cli,
      storagePath,
      variantAnalysisResultsManager,
    );
  });

  describe("runVariantAnalysis", () => {
    const progress = jest.fn();
    const showQuickPickSpy = jest.spyOn(window, "showQuickPick");
    const mockGetRepositoryFromNwo = jest.spyOn(
      ghApiClient,
      "getRepositoryFromNwo",
    );
    const mockSubmitVariantAnalysis = jest.spyOn(
      ghApiClient,
      "submitVariantAnalysis",
    );
    let mockApiResponse: VariantAnalysisApiResponse;
    let originalDeps: Record<string, string> | undefined;
    const executeCommandSpy = jest.spyOn(commands, "executeCommand");

    const baseDir = path.join(
      __dirname,
      "../../../../src/vscode-tests/cli-integration",
    );
    const qlpackFileWithWorkspaceRefs = getFile(
      "data-remote-qlpack/qlpack.yml",
    ).fsPath;

    function getFile(file: string): Uri {
      return Uri.file(path.join(baseDir, file));
    }

    beforeEach(async () => {
      writeFileStub.mockRestore();

      progress.mockReset();
      // Should not have asked for a language
      showQuickPickSpy
        .mockReset()
        .mockResolvedValueOnce({
          repositories: ["github/vscode-codeql"],
        } as unknown as QuickPickItem)
        .mockResolvedValueOnce("javascript" as unknown as QuickPickItem);

      executeCommandSpy.mockRestore();

      cancellationTokenSource = new CancellationTokenSource();

      const dummyRepository: Repository = {
        id: 123,
        name: "vscode-codeql",
        full_name: "github/vscode-codeql",
        private: false,
      };
      mockGetRepositoryFromNwo.mockReset().mockResolvedValue(dummyRepository);

      mockApiResponse = createMockApiResponse("in_progress");
      mockSubmitVariantAnalysis.mockReset().mockResolvedValue(mockApiResponse);

      // always run in the vscode-codeql repo
      await setRemoteControllerRepo("github/vscode-codeql");
      await setRemoteRepositoryLists({
        "vscode-codeql": ["github/vscode-codeql"],
      });

      // Only new version support `${workspace}` in qlpack.yml
      originalDeps = await fixWorkspaceReferences(
        qlpackFileWithWorkspaceRefs,
        cli,
      );
    });

    afterEach(async () => {
      await restoreWorkspaceReferences(
        qlpackFileWithWorkspaceRefs,
        originalDeps,
      );
    });

    it("should run a variant analysis that is part of a qlpack", async () => {
      const fileUri = getFile("data-remote-qlpack/in-pack.ql");

      await variantAnalysisManager.runVariantAnalysis(
        fileUri,
        progress,
        cancellationTokenSource.token,
      );

      expect(executeCommandSpy).toBeCalledWith(
        "codeQL.monitorVariantAnalysis",
        expect.objectContaining({
          id: mockApiResponse.id,
          status: VariantAnalysisStatus.InProgress,
        }),
      );

      expect(showQuickPickSpy).toBeCalledTimes(1);

      expect(mockGetRepositoryFromNwo).toBeCalledTimes(1);
      expect(mockSubmitVariantAnalysis).toBeCalledTimes(1);
    });

    it("should run a remote query that is not part of a qlpack", async () => {
      const fileUri = getFile("data-remote-no-qlpack/in-pack.ql");

      await variantAnalysisManager.runVariantAnalysis(
        fileUri,
        progress,
        cancellationTokenSource.token,
      );

      expect(executeCommandSpy).toBeCalledWith(
        "codeQL.monitorVariantAnalysis",
        expect.objectContaining({
          id: mockApiResponse.id,
          status: VariantAnalysisStatus.InProgress,
        }),
      );

      expect(mockGetRepositoryFromNwo).toBeCalledTimes(1);
      expect(mockSubmitVariantAnalysis).toBeCalledTimes(1);
    });

    it("should run a remote query that is nested inside a qlpack", async () => {
      const fileUri = getFile("data-remote-qlpack-nested/subfolder/in-pack.ql");

      await variantAnalysisManager.runVariantAnalysis(
        fileUri,
        progress,
        cancellationTokenSource.token,
      );

      expect(executeCommandSpy).toBeCalledWith(
        "codeQL.monitorVariantAnalysis",
        expect.objectContaining({
          id: mockApiResponse.id,
          status: VariantAnalysisStatus.InProgress,
        }),
      );

      expect(mockGetRepositoryFromNwo).toBeCalledTimes(1);
      expect(mockSubmitVariantAnalysis).toBeCalledTimes(1);
    });

    it("should cancel a run before uploading", async () => {
      const fileUri = getFile("data-remote-no-qlpack/in-pack.ql");

      const promise = variantAnalysisManager.runVariantAnalysis(
        fileUri,
        progress,
        cancellationTokenSource.token,
      );

      cancellationTokenSource.cancel();

      await expect(promise).rejects.toThrow(UserCancellationException);
    });
  });

  describe("rehydrateVariantAnalysis", () => {
    const variantAnalysis = createMockVariantAnalysis({});

    describe("when the directory does not exist", () => {
      beforeEach(() => {
        const originalFs = jest.requireActual<typeof fs>("fs-extras");
        pathExistsStub.mockReset().mockImplementation((...args) => {
          if (
            args[0] === path.join(storagePath, variantAnalysis.id.toString())
          ) {
            return false;
          }
          return originalFs.pathExists(...args);
        });
      });

      it("should fire the removed event if the file does not exist", async () => {
        const stub = jest.fn();
        variantAnalysisManager.onVariantAnalysisRemoved(stub);

        await variantAnalysisManager.rehydrateVariantAnalysis(variantAnalysis);

        expect(stub).toBeCalledTimes(1);
        expect(pathExistsStub).toBeCalledWith(
          path.join(storagePath, variantAnalysis.id.toString()),
        );
      });
    });

    describe("when the directory exists", () => {
      beforeEach(() => {
        const originalFs = jest.requireActual<typeof fs>("fs-extras");
        pathExistsStub.mockReset().mockImplementation((...args) => {
          if (
            args[0] === path.join(storagePath, variantAnalysis.id.toString())
          ) {
            return true;
          }
          return originalFs.pathExists(...args);
        });
      });

      it("should store the variant analysis", async () => {
        await variantAnalysisManager.rehydrateVariantAnalysis(variantAnalysis);

        expect(
          await variantAnalysisManager.getVariantAnalysis(variantAnalysis.id),
        ).toEqual(variantAnalysis);
      });

      it("should not error if the repo states file does not exist", async () => {
        const originalFs = jest.requireActual<typeof fs>("fs-extras");
        readJsonStub.mockImplementation((...args) => {
          if (
            args[0] ===
            path.join(
              storagePath,
              variantAnalysis.id.toString(),
              "repo_states.json",
            )
          ) {
            return Promise.reject(new Error("File does not exist"));
          }
          return originalFs.readJson(...args);
        });

        await variantAnalysisManager.rehydrateVariantAnalysis(variantAnalysis);

        expect(readJsonStub).toHaveBeenCalledWith(
          path.join(
            storagePath,
            variantAnalysis.id.toString(),
            "repo_states.json",
          ),
        );
        expect(
          await variantAnalysisManager.getRepoStates(variantAnalysis.id),
        ).toEqual([]);
      });

      it("should read in the repo states if it exists", async () => {
        const originalFs = jest.requireActual<typeof fs>("fs-extras");
        readJsonStub.mockImplementation((...args) => {
          if (
            args[0] ===
            path.join(
              storagePath,
              variantAnalysis.id.toString(),
              "repo_states.json",
            )
          ) {
            return Promise.resolve({
              [scannedRepos[0].repository.id]: {
                repositoryId: scannedRepos[0].repository.id,
                downloadStatus:
                  VariantAnalysisScannedRepositoryDownloadStatus.Succeeded,
              },
              [scannedRepos[1].repository.id]: {
                repositoryId: scannedRepos[1].repository.id,
                downloadStatus:
                  VariantAnalysisScannedRepositoryDownloadStatus.InProgress,
              },
            });
          }
          return originalFs.readJson(...args);
        });

        await variantAnalysisManager.rehydrateVariantAnalysis(variantAnalysis);

        expect(readJsonStub).toHaveBeenCalledWith(
          path.join(
            storagePath,
            variantAnalysis.id.toString(),
            "repo_states.json",
          ),
        );
        expect(
          await variantAnalysisManager.getRepoStates(variantAnalysis.id),
        ).toEqual(
          expect.arrayContaining([
            {
              repositoryId: scannedRepos[0].repository.id,
              downloadStatus:
                VariantAnalysisScannedRepositoryDownloadStatus.Succeeded,
            },
            {
              repositoryId: scannedRepos[1].repository.id,
              downloadStatus:
                VariantAnalysisScannedRepositoryDownloadStatus.InProgress,
            },
          ]),
        );
      });
    });
  });

  describe("when credentials are invalid", () => {
    beforeEach(async () => {
      jest
        .spyOn(Credentials, "initialize")
        .mockResolvedValue(undefined as unknown as Credentials);
    });

    it("should return early if credentials are wrong", async () => {
      try {
        await variantAnalysisManager.autoDownloadVariantAnalysisResult(
          scannedRepos[0],
          variantAnalysis,
          cancellationTokenSource.token,
        );
      } catch (error: any) {
        expect(error.message).toBe("Error authenticating with GitHub");
      }
    });
  });

  describe("when credentials are valid", () => {
    let arrayBuffer: ArrayBuffer;

    const getVariantAnalysisRepoStub = jest.spyOn(
      ghApiClient,
      "getVariantAnalysisRepo",
    );
    const getVariantAnalysisRepoResultStub = jest.spyOn(
      ghApiClient,
      "getVariantAnalysisRepoResult",
    );

    beforeEach(async () => {
      const mockCredentials = {
        getOctokit: () =>
          Promise.resolve({
            request: jest.fn(),
          }),
      } as unknown as Credentials;
      jest.spyOn(Credentials, "initialize").mockResolvedValue(mockCredentials);

      const sourceFilePath = path.join(
        __dirname,
        "../../../../src/vscode-tests/cli-integration/data/variant-analysis-results.zip",
      );
      arrayBuffer = fs.readFileSync(sourceFilePath).buffer;

      getVariantAnalysisRepoStub.mockReset();
      getVariantAnalysisRepoResultStub.mockReset();
    });

    describe("when the artifact_url is missing", () => {
      beforeEach(async () => {
        const dummyRepoTask = createMockVariantAnalysisRepoTask();
        delete dummyRepoTask.artifact_url;

        getVariantAnalysisRepoStub.mockResolvedValue(dummyRepoTask);
        getVariantAnalysisRepoResultStub.mockResolvedValue(arrayBuffer);
      });

      it("should not try to download the result", async () => {
        await variantAnalysisManager.autoDownloadVariantAnalysisResult(
          scannedRepos[0],
          variantAnalysis,
          cancellationTokenSource.token,
        );

        expect(getVariantAnalysisRepoResultStub).not.toHaveBeenCalled();
      });
    });

    describe("when the artifact_url is present", () => {
      let dummyRepoTask: VariantAnalysisRepoTask;

      beforeEach(async () => {
        dummyRepoTask = createMockVariantAnalysisRepoTask();

        getVariantAnalysisRepoStub.mockResolvedValue(dummyRepoTask);
        getVariantAnalysisRepoResultStub.mockResolvedValue(arrayBuffer);
      });

      describe("autoDownloadVariantAnalysisResult", () => {
        it("should return early if variant analysis is cancelled", async () => {
          cancellationTokenSource.cancel();

          await variantAnalysisManager.autoDownloadVariantAnalysisResult(
            scannedRepos[0],
            variantAnalysis,
            cancellationTokenSource.token,
          );

          expect(getVariantAnalysisRepoStub).not.toHaveBeenCalled();
        });

        it("should fetch a repo task", async () => {
          await variantAnalysisManager.autoDownloadVariantAnalysisResult(
            scannedRepos[0],
            variantAnalysis,
            cancellationTokenSource.token,
          );

          expect(getVariantAnalysisRepoStub).toHaveBeenCalled();
        });

        it("should fetch a repo result", async () => {
          await variantAnalysisManager.autoDownloadVariantAnalysisResult(
            scannedRepos[0],
            variantAnalysis,
            cancellationTokenSource.token,
          );

          expect(getVariantAnalysisRepoResultStub).toHaveBeenCalled();
        });

        it("should skip the download if the repository has already been downloaded", async () => {
          // First, do a download so it is downloaded. This avoids having to mock the repo states.
          await variantAnalysisManager.autoDownloadVariantAnalysisResult(
            scannedRepos[0],
            variantAnalysis,
            cancellationTokenSource.token,
          );

          getVariantAnalysisRepoStub.mockClear();

          await variantAnalysisManager.autoDownloadVariantAnalysisResult(
            scannedRepos[0],
            variantAnalysis,
            cancellationTokenSource.token,
          );

          expect(getVariantAnalysisRepoStub).not.toHaveBeenCalled();
        });

        it("should write the repo state when the download is successful", async () => {
          await variantAnalysisManager.autoDownloadVariantAnalysisResult(
            scannedRepos[0],
            variantAnalysis,
            cancellationTokenSource.token,
          );

          expect(outputJsonStub).toHaveBeenCalledWith(
            path.join(
              storagePath,
              variantAnalysis.id.toString(),
              "repo_states.json",
            ),
            {
              [scannedRepos[0].repository.id]: {
                repositoryId: scannedRepos[0].repository.id,
                downloadStatus:
                  VariantAnalysisScannedRepositoryDownloadStatus.Succeeded,
              },
            },
          );
        });

        it("should not write the repo state when the download fails", async () => {
          getVariantAnalysisRepoResultStub.mockRejectedValue(
            new Error("Failed to download"),
          );

          await expect(
            variantAnalysisManager.autoDownloadVariantAnalysisResult(
              scannedRepos[0],
              variantAnalysis,
              cancellationTokenSource.token,
            ),
          ).rejects.toThrow();

          expect(outputJsonStub).not.toHaveBeenCalled();
        });

        it("should have a failed repo state when the repo task API fails", async () => {
          getVariantAnalysisRepoStub.mockRejectedValueOnce(
            new Error("Failed to download"),
          );

          await expect(
            variantAnalysisManager.autoDownloadVariantAnalysisResult(
              scannedRepos[0],
              variantAnalysis,
              cancellationTokenSource.token,
            ),
          ).rejects.toThrow();

          expect(outputJsonStub).not.toHaveBeenCalled();

          await variantAnalysisManager.autoDownloadVariantAnalysisResult(
            scannedRepos[1],
            variantAnalysis,
            cancellationTokenSource.token,
          );

          expect(outputJsonStub).toHaveBeenCalledWith(
            path.join(
              storagePath,
              variantAnalysis.id.toString(),
              "repo_states.json",
            ),
            {
              [scannedRepos[0].repository.id]: {
                repositoryId: scannedRepos[0].repository.id,
                downloadStatus:
                  VariantAnalysisScannedRepositoryDownloadStatus.Failed,
              },
              [scannedRepos[1].repository.id]: {
                repositoryId: scannedRepos[1].repository.id,
                downloadStatus:
                  VariantAnalysisScannedRepositoryDownloadStatus.Succeeded,
              },
            },
          );
        });

        it("should have a failed repo state when the download fails", async () => {
          getVariantAnalysisRepoResultStub.mockRejectedValueOnce(
            new Error("Failed to download"),
          );

          await expect(
            variantAnalysisManager.autoDownloadVariantAnalysisResult(
              scannedRepos[0],
              variantAnalysis,
              cancellationTokenSource.token,
            ),
          ).rejects.toThrow();

          expect(outputJsonStub).not.toHaveBeenCalled();

          await variantAnalysisManager.autoDownloadVariantAnalysisResult(
            scannedRepos[1],
            variantAnalysis,
            cancellationTokenSource.token,
          );

          expect(outputJsonStub).toHaveBeenCalledWith(
            path.join(
              storagePath,
              variantAnalysis.id.toString(),
              "repo_states.json",
            ),
            {
              [scannedRepos[0].repository.id]: {
                repositoryId: scannedRepos[0].repository.id,
                downloadStatus:
                  VariantAnalysisScannedRepositoryDownloadStatus.Failed,
              },
              [scannedRepos[1].repository.id]: {
                repositoryId: scannedRepos[1].repository.id,
                downloadStatus:
                  VariantAnalysisScannedRepositoryDownloadStatus.Succeeded,
              },
            },
          );
        });

        it("should update the repo state correctly", async () => {
          // To set some initial repo states, we need to mock the correct methods so that the repo states are read in.
          // The actual tests for these are in rehydrateVariantAnalysis, so we can just mock them here and test that
          // the methods are called.

          const originalFs = jest.requireActual<typeof fs>("fs-extras");
          pathExistsStub.mockReset().mockImplementation((...args) => {
            if (
              args[0] === path.join(storagePath, variantAnalysis.id.toString())
            ) {
              return false;
            }
            return originalFs.pathExists(...args);
          });
          // This will read in the correct repo states
          readJsonStub.mockImplementation((...args) => {
            if (
              args[0] ===
              path.join(
                storagePath,
                variantAnalysis.id.toString(),
                "repo_states.json",
              )
            ) {
              return Promise.resolve({
                [scannedRepos[1].repository.id]: {
                  repositoryId: scannedRepos[1].repository.id,
                  downloadStatus:
                    VariantAnalysisScannedRepositoryDownloadStatus.Succeeded,
                },
                [scannedRepos[2].repository.id]: {
                  repositoryId: scannedRepos[2].repository.id,
                  downloadStatus:
                    VariantAnalysisScannedRepositoryDownloadStatus.InProgress,
                },
              });
            }
            return originalFs.readJson(...args);
          });

          await variantAnalysisManager.rehydrateVariantAnalysis(
            variantAnalysis,
          );
          expect(readJsonStub).toHaveBeenCalledWith(
            path.join(
              storagePath,
              variantAnalysis.id.toString(),
              "repo_states.json",
            ),
          );

          await variantAnalysisManager.autoDownloadVariantAnalysisResult(
            scannedRepos[0],
            variantAnalysis,
            cancellationTokenSource.token,
          );

          expect(outputJsonStub).toHaveBeenCalledWith(
            path.join(
              storagePath,
              variantAnalysis.id.toString(),
              "repo_states.json",
            ),
            {
              [scannedRepos[1].repository.id]: {
                repositoryId: scannedRepos[1].repository.id,
                downloadStatus:
                  VariantAnalysisScannedRepositoryDownloadStatus.Succeeded,
              },
              [scannedRepos[2].repository.id]: {
                repositoryId: scannedRepos[2].repository.id,
                downloadStatus:
                  VariantAnalysisScannedRepositoryDownloadStatus.InProgress,
              },
              [scannedRepos[0].repository.id]: {
                repositoryId: scannedRepos[0].repository.id,
                downloadStatus:
                  VariantAnalysisScannedRepositoryDownloadStatus.Succeeded,
              },
            },
          );
        });
      });

      describe("enqueueDownload", () => {
        it("should pop download tasks off the queue", async () => {
          const getResultsSpy = jest.spyOn(
            variantAnalysisManager,
            "autoDownloadVariantAnalysisResult",
          );

          await variantAnalysisManager.enqueueDownload(
            scannedRepos[0],
            variantAnalysis,
            cancellationTokenSource.token,
          );
          await variantAnalysisManager.enqueueDownload(
            scannedRepos[1],
            variantAnalysis,
            cancellationTokenSource.token,
          );
          await variantAnalysisManager.enqueueDownload(
            scannedRepos[2],
            variantAnalysis,
            cancellationTokenSource.token,
          );

          expect(variantAnalysisManager.downloadsQueueSize()).toBe(0);
          expect(getResultsSpy).toBeCalledTimes(3);
        });
      });

      describe("removeVariantAnalysis", () => {
        const removeAnalysisResultsStub = jest.spyOn(
          variantAnalysisResultsManager,
          "removeAnalysisResults",
        );
        const removeStorageStub = jest.spyOn(fs, "remove");
        let dummyVariantAnalysis: VariantAnalysis;

        beforeEach(async () => {
          dummyVariantAnalysis = createMockVariantAnalysis({});
          removeAnalysisResultsStub.mockReset().mockReturnValue(undefined);
          removeStorageStub.mockReset().mockReturnValue(undefined);
        });

        it("should remove variant analysis", async () => {
          await variantAnalysisManager.onVariantAnalysisUpdated(
            dummyVariantAnalysis,
          );
          expect(variantAnalysisManager.variantAnalysesSize).toBe(1);

          await variantAnalysisManager.removeVariantAnalysis(
            dummyVariantAnalysis,
          );

          expect(removeAnalysisResultsStub).toBeCalledTimes(1);
          expect(removeStorageStub).toBeCalledTimes(1);
          expect(variantAnalysisManager.variantAnalysesSize).toBe(0);
        });
      });
    });
  });

  describe("when rehydrating a query", () => {
    let variantAnalysis: VariantAnalysis;
    const variantAnalysisRemovedSpy = jest.fn();
    const executeCommandSpy = jest.spyOn(commands, "executeCommand");

    beforeEach(() => {
      variantAnalysis = createMockVariantAnalysis({});

      variantAnalysisRemovedSpy.mockReset();
      variantAnalysisManager.onVariantAnalysisRemoved(
        variantAnalysisRemovedSpy,
      );

      executeCommandSpy.mockReset().mockResolvedValue(undefined);
    });

    describe("when variant analysis record doesn't exist", () => {
      it("should remove the variant analysis", async () => {
        await variantAnalysisManager.rehydrateVariantAnalysis(variantAnalysis);
        expect(variantAnalysisRemovedSpy).toHaveBeenCalledTimes(1);
      });

      it("should not trigger a monitoring command", async () => {
        await variantAnalysisManager.rehydrateVariantAnalysis(variantAnalysis);
        expect(executeCommandSpy).not.toHaveBeenCalled();
      });
    });

    describe("when variant analysis record does exist", () => {
      let variantAnalysisStorageLocation: string;

      beforeEach(async () => {
        variantAnalysisStorageLocation =
          variantAnalysisManager.getVariantAnalysisStorageLocation(
            variantAnalysis.id,
          );
        await createTimestampFile(variantAnalysisStorageLocation);
      });

      afterEach(() => {
        fs.rmSync(variantAnalysisStorageLocation, { recursive: true });
      });

      describe("when the variant analysis is not complete", () => {
        beforeEach(() => {
          jest
            .spyOn(VariantAnalysisModule, "isVariantAnalysisComplete")
            .mockResolvedValue(false);
        });

        it("should not remove the variant analysis", async () => {
          await variantAnalysisManager.rehydrateVariantAnalysis(
            variantAnalysis,
          );
          expect(variantAnalysisRemovedSpy).not.toHaveBeenCalled();
        });

        it("should trigger a monitoring command", async () => {
          await variantAnalysisManager.rehydrateVariantAnalysis(
            variantAnalysis,
          );
          expect(executeCommandSpy).toHaveBeenCalledWith(
            "codeQL.monitorVariantAnalysis",
            expect.anything(),
          );
        });
      });

      describe("when the variant analysis is complete", () => {
        beforeEach(() => {
          jest
            .spyOn(VariantAnalysisModule, "isVariantAnalysisComplete")
            .mockResolvedValue(true);
        });

        it("should not remove the variant analysis", async () => {
          await variantAnalysisManager.rehydrateVariantAnalysis(
            variantAnalysis,
          );
          expect(variantAnalysisRemovedSpy).not.toHaveBeenCalled();
        });

        it("should not trigger a monitoring command", async () => {
          await variantAnalysisManager.rehydrateVariantAnalysis(
            variantAnalysis,
          );
          expect(executeCommandSpy).not.toHaveBeenCalled();
        });
      });
    });
  });

  describe("cancelVariantAnalysis", () => {
    let variantAnalysis: VariantAnalysis;
    const mockCancelVariantAnalysis = jest.spyOn(
      ghActionsApiClient,
      "cancelVariantAnalysis",
    );

    let variantAnalysisStorageLocation: string;

    beforeEach(async () => {
      variantAnalysis = createMockVariantAnalysis({});

      mockCancelVariantAnalysis.mockReset().mockResolvedValue(undefined);

      variantAnalysisStorageLocation =
        variantAnalysisManager.getVariantAnalysisStorageLocation(
          variantAnalysis.id,
        );
      await createTimestampFile(variantAnalysisStorageLocation);
      await variantAnalysisManager.rehydrateVariantAnalysis(variantAnalysis);
    });

    afterEach(() => {
      fs.rmSync(variantAnalysisStorageLocation, { recursive: true });
    });

    describe("when the credentials are invalid", () => {
      beforeEach(async () => {
        jest
          .spyOn(Credentials, "initialize")
          .mockResolvedValue(undefined as unknown as Credentials);
      });

      it("should return early", async () => {
        try {
          await variantAnalysisManager.cancelVariantAnalysis(
            variantAnalysis.id,
          );
        } catch (error: any) {
          expect(error.message).toBe("Error authenticating with GitHub");
        }
      });
    });

    describe("when the credentials are valid", () => {
      let mockCredentials: Credentials;

      beforeEach(async () => {
        mockCredentials = {
          getOctokit: () =>
            Promise.resolve({
              request: jest.fn(),
            }),
        } as unknown as Credentials;
        jest
          .spyOn(Credentials, "initialize")
          .mockResolvedValue(mockCredentials);
      });

      it("should return early if the variant analysis is not found", async () => {
        try {
          await variantAnalysisManager.cancelVariantAnalysis(
            variantAnalysis.id + 100,
          );
        } catch (error: any) {
          expect(error.message).toBe(
            "No variant analysis with id: " + (variantAnalysis.id + 100),
          );
        }
      });

      it("should return early if the variant analysis does not have an actions workflow run id", async () => {
        await variantAnalysisManager.onVariantAnalysisUpdated({
          ...variantAnalysis,
          actionsWorkflowRunId: undefined,
        });

        try {
          await variantAnalysisManager.cancelVariantAnalysis(
            variantAnalysis.id,
          );
        } catch (error: any) {
          expect(error.message).toBe(
            `No workflow run id for variant analysis with id: ${variantAnalysis.id}`,
          );
        }
      });

      it("should return cancel if valid", async () => {
        await variantAnalysisManager.cancelVariantAnalysis(variantAnalysis.id);

        expect(mockCancelVariantAnalysis).toBeCalledWith(
          mockCredentials,
          variantAnalysis,
        );
      });
    });
  });

  describe("copyRepoListToClipboard", () => {
    let variantAnalysis: VariantAnalysis;
    let variantAnalysisStorageLocation: string;

    const writeTextStub = jest.fn();

    beforeEach(async () => {
      variantAnalysis = createMockVariantAnalysis({});

      variantAnalysisStorageLocation =
        variantAnalysisManager.getVariantAnalysisStorageLocation(
          variantAnalysis.id,
        );
      await createTimestampFile(variantAnalysisStorageLocation);
      await variantAnalysisManager.rehydrateVariantAnalysis(variantAnalysis);

      writeTextStub.mockReset();
      jest.spyOn(env, "clipboard", "get").mockReturnValue({
        readText: jest.fn(),
        writeText: writeTextStub,
      });
    });

    afterEach(() => {
      fs.rmSync(variantAnalysisStorageLocation, { recursive: true });
    });

    describe("when the variant analysis does not have any repositories", () => {
      beforeEach(async () => {
        await variantAnalysisManager.rehydrateVariantAnalysis({
          ...variantAnalysis,
          scannedRepos: [],
        });
      });

      it("should not copy any text", async () => {
        await variantAnalysisManager.copyRepoListToClipboard(
          variantAnalysis.id,
        );

        expect(writeTextStub).not.toBeCalled();
      });
    });

    describe("when the variant analysis does not have any repositories with results", () => {
      beforeEach(async () => {
        await variantAnalysisManager.rehydrateVariantAnalysis({
          ...variantAnalysis,
          scannedRepos: [
            {
              ...createMockScannedRepo(),
              resultCount: 0,
            },
            {
              ...createMockScannedRepo(),
              resultCount: undefined,
            },
          ],
        });
      });

      it("should not copy any text", async () => {
        await variantAnalysisManager.copyRepoListToClipboard(
          variantAnalysis.id,
        );

        expect(writeTextStub).not.toBeCalled();
      });
    });

    describe("when the variant analysis has repositories with results", () => {
      const scannedRepos = [
        {
          ...createMockScannedRepo("pear"),
          resultCount: 100,
        },
        {
          ...createMockScannedRepo("apple"),
          resultCount: 0,
        },
        {
          ...createMockScannedRepo("citrus"),
          resultCount: 200,
        },
        {
          ...createMockScannedRepo("sky"),
          resultCount: undefined,
        },
        {
          ...createMockScannedRepo("banana"),
          resultCount: 5,
        },
      ];

      beforeEach(async () => {
        await variantAnalysisManager.rehydrateVariantAnalysis({
          ...variantAnalysis,
          scannedRepos,
        });
      });

      it("should copy text", async () => {
        await variantAnalysisManager.copyRepoListToClipboard(
          variantAnalysis.id,
        );

        expect(writeTextStub).toBeCalledTimes(1);
      });

      it("should be valid JSON when put in object", async () => {
        await variantAnalysisManager.copyRepoListToClipboard(
          variantAnalysis.id,
        );

        const text = writeTextStub.mock.calls[0][0];

        const parsed = JSON.parse("{" + text + "}");

        expect(parsed).toEqual({
          "new-repo-list": [
            scannedRepos[4].repository.fullName,
            scannedRepos[2].repository.fullName,
            scannedRepos[0].repository.fullName,
          ],
        });
      });

      it("should use the sort key", async () => {
        await variantAnalysisManager.copyRepoListToClipboard(
          variantAnalysis.id,
          {
            ...defaultFilterSortState,
            sortKey: SortKey.ResultsCount,
          },
        );

        const text = writeTextStub.mock.calls[0][0];

        const parsed = JSON.parse("{" + text + "}");

        expect(parsed).toEqual({
          "new-repo-list": [
            scannedRepos[2].repository.fullName,
            scannedRepos[0].repository.fullName,
            scannedRepos[4].repository.fullName,
          ],
        });
      });

      it("should use the search value", async () => {
        await variantAnalysisManager.copyRepoListToClipboard(
          variantAnalysis.id,
          {
            ...defaultFilterSortState,
            searchValue: "ban",
          },
        );

        const text = writeTextStub.mock.calls[0][0];

        const parsed = JSON.parse("{" + text + "}");

        expect(parsed).toEqual({
          "new-repo-list": [scannedRepos[4].repository.fullName],
        });
      });
    });
  });
});
