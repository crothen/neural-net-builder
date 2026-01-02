import { BaseNode } from './nodes/BaseNode';
import { BrainNode } from './nodes/BrainNode';
import { InputNode } from './nodes/InputNode';
import { OutputNode, SustainedOutputNode } from './nodes/OutputNode';
import { type NodeConfig, NodeType } from './types';

export class NodeFactory {
    public static create(config: NodeConfig): BaseNode {
        const { type, activationType } = config;

        // 1. INPUT
        if (type === NodeType.INPUT) {
            return new InputNode(config);
        }

        // 2. OUTPUT / INTERPRETATION
        if (type === NodeType.OUTPUT || type === NodeType.INTERPRETATION || type === NodeType.LEARNED) {
            if (activationType === 'SUSTAINED') {
                return new SustainedOutputNode(config);
            }
            return new OutputNode(config);
        }

        // 3. BRAIN (HIDDEN)
        if (type === NodeType.HIDDEN || type === NodeType.CONCEPT) {
            return new BrainNode(config);
        }

        // Fallback default
        return new BrainNode(config);
    }
}
