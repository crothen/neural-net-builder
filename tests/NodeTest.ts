
import { Node } from '../src/engine/Node';
import { NodeType } from '../src/engine/types';

export class NodeTest {
    private passed = 0;
    private failed = 0;

    private assert(condition: boolean, message: string) {
        if (condition) {
            this.passed++;
            // console.log(`✓ ${message}`);
        } else {
            this.failed++;
            console.error(`✗ FAIL: ${message}`);
        }
    }

    private createNode(type: 'PULSE' | 'SUSTAINED', refractoryPeriod: number, threshold: number = 1.0) {
        return new Node({
            id: 'test',
            type: NodeType.HIDDEN,
            x: 0,
            y: 0,
            label: 'Test',
            activationType: type,
            refractoryPeriod: refractoryPeriod,
            threshold: threshold,
            decay: 0.1
        });
    }

    public run() {
        console.log('--- Starting Node Logic Tests ---');

        this.testPulseRefractory();
        this.testSustainedRefractory();
        this.testRateLimiting();

        console.log('---------------------------------');
        console.log(`Tests Completed: ${this.passed + this.failed}`);
        console.log(`Passed: ${this.passed}`);
        console.log(`Failed: ${this.failed}`);

        if (this.failed > 0) process.exit(1);
        process.exit(0);
    }

    // TEST 1: PULSE nodes should reset potential and respect refractory
    private testPulseRefractory() {
        console.log('\n[Test] Pulse Node Refractory');
        const node = this.createNode('PULSE', 2);

        // Tick 1: Fire
        node.update(1.5);
        this.assert(node.isFiring, 'Node fired on strong input');
        this.assert(node.potential < 1.0, 'Potential reset after pulse');

        // Tick 2: Refractory
        node.update(1.5);
        this.assert(!node.isFiring, 'Node did NOT fire during refractory (1/2)');

        // Tick 3: Refractory
        node.update(1.5);
        this.assert(!node.isFiring, 'Node did NOT fire during refractory (2/2)');

        // Tick 4: Ready
        node.update(1.5);
        this.assert(node.isFiring, 'Node fired after refractory period');
    }

    // TEST 2: SUSTAINED nodes should maintain potential but respect refractory
    private testSustainedRefractory() {
        console.log('\n[Test] Sustained Node Refractory');
        const node = this.createNode('SUSTAINED', 2);

        // Tick 1: Fire
        node.update(1.5);
        this.assert(node.isFiring, 'Node fired on strong input');
        // Critical: Potential should NOT reset for Sustained
        this.assert(node.potential >= 1.0, 'Potential maintained (Sustained)');

        // Tick 2: Refractory
        node.update(1.5);
        this.assert(!node.isFiring, 'Node did NOT fire during refractory (1/2)');
        this.assert(node.potential >= 1.0, 'Potential still maintained during refractory');

        // Tick 3: Refractory
        node.update(1.5);
        this.assert(!node.isFiring, 'Node did NOT fire during refractory (2/2)');

        // Tick 4: Ready
        node.update(1.5);
        this.assert(node.isFiring, 'Node fired immediately after refractory due to sustained potential');
    }

    // TEST 3: Verify Rate Limiting Statistics
    private testRateLimiting() {
        console.log('\n[Test] Rate Limiting Statistics (Sustained)');
        const node = this.createNode('SUSTAINED', 1); // 1 tick refractory

        let firedCount = 0;
        const ticks = 100;

        for (let i = 0; i < ticks; i++) {
            node.update(1.5); // Constant high input
            if (node.isFiring) firedCount++;
        }

        console.log(`Fired ${firedCount}/${ticks} ticks with Refractory=1`);

        // With Refractory 1, we expect roughly 50% duty cycle (Fire, Wait, Fire, Wait)
        // Jitter might skew it slightly, but should be < 60.
        this.assert(firedCount < 60 && firedCount > 30, 'Firing rate is limited approx 50%');
    }
}

// Auto-run if executed directly
new NodeTest().run();
