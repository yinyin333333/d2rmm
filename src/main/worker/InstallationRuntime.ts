import type { IBridgeAPI, IInstallModsOptions, Mod } from 'bridge/BridgeAPI';
import type { ConsoleAPI } from 'bridge/ConsoleAPI';
import { FileManager } from './FileManager';
import { SaveFileTransaction } from './SaveFileTransaction';

export class InstallationRuntime {
  private mod_: Mod | null = null;
  private modTransactionCheckpoint: {
    nextStringID: number;
    nextStringIDRaw: string | null;
  } | null = null;

  public fileManager: FileManager;
  public modsInstalled: string[] = [];
  public nextStringID = 0;
  public nextStringIDRaw: string | null = null;
  public saveFiles = new SaveFileTransaction();

  constructor(
    public BridgeAPI: IBridgeAPI,
    public console: ConsoleAPI,
    public options: IInstallModsOptions,
    public modsToInstall: Mod[],
  ) {
    this.fileManager = new FileManager(this);
  }

  isModInstalling(): boolean {
    return this.mod_ != null;
  }

  public set mod(mod: Mod | null) {
    this.mod_ = mod;
  }

  public get mod(): Mod {
    if (!this.mod_) {
      throw new Error('No mod is currently being installed.');
    }
    return this.mod_;
  }

  public beginModTransaction(): void {
    if (this.modTransactionCheckpoint != null) {
      throw new Error('A mod transaction is already active.');
    }

    this.fileManager.beginTransaction();
    try {
      this.saveFiles.beginTransaction();
    } catch (error) {
      this.fileManager.rollbackTransaction();
      throw error;
    }
    this.modTransactionCheckpoint = {
      nextStringID: this.nextStringID,
      nextStringIDRaw: this.nextStringIDRaw,
    };
  }

  public commitModTransaction(): void {
    if (this.modTransactionCheckpoint == null) {
      throw new Error('No mod transaction is active.');
    }
    this.fileManager.commitTransaction();
    this.saveFiles.commitTransaction();
    this.modTransactionCheckpoint = null;
  }

  public rollbackModTransaction(): void {
    if (this.modTransactionCheckpoint == null) {
      throw new Error('No mod transaction is active.');
    }

    const checkpoint = this.modTransactionCheckpoint;
    this.fileManager.rollbackTransaction();
    this.saveFiles.rollbackTransaction();
    this.nextStringID = checkpoint.nextStringID;
    this.nextStringIDRaw = checkpoint.nextStringIDRaw;
    this.modTransactionCheckpoint = null;
  }
}
