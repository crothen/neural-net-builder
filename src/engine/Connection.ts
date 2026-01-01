import type { ConnectionConfig } from './types.ts';

export class Connection {
    public id: string;
    public sourceId: string;
    public targetId: string;
    public weight: number;

    // For visualization: last transmitted signal strength
    public signalStrength: number = 0;

    constructor(config: ConnectionConfig) {
        this.id = config.id;
        this.sourceId = config.sourceId;
        this.targetId = config.targetId;
        this.weight = config.weight;
    }
}
