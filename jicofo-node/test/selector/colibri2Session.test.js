const { expect } = require('chai');
const Colibri2Session = require('../../lib/colibri2Session');

describe('Colibri2Session', () => {
    let session;
    let logger;
    let bridge;
    let sessionManager;

    beforeEach(() => {
        logger = {
            info: () => {},
            debug: () => {},
            error: () => {}
        };
        bridge = { relayId: 'relay-1' };
        sessionManager = {};
        session = new Colibri2Session(sessionManager, bridge, false, logger);
    });

    it('should generate a unique session id', () => {
        expect(session.id).to.be.a('string');
        expect(session.id.length).to.be.greaterThan(0);
    });

    it('should allocate a participant and mark session as created', async () => {
        const participant = { id: 'p1' };
        const response = await session.sendAllocationRequest(participant);
        expect(response.success).to.be.true;
        expect(session.created).to.be.true;
    });

    it('should update a participant', async () => {
        const participant = { id: 'p2' };
        await session.updateParticipant(participant, { ice: true }, { audio: true }, 5);
        // No error means success for stub
    });

    it('should create and manage relays', () => {
        session.createRelay('relay-2', [{ id: 'p3' }], true, 'mesh-1');
        expect(session.relays.has('relay-2')).to.be.true;
        expect(() => session.createRelay('relay-2', [], false, 'mesh-1')).to.throw();
    });

    it('should expire the session and clear relays', async () => {
        session.createRelay('relay-2', [{ id: 'p3' }], true, 'mesh-1');
        await session.expire();
        expect(session.relays.size).to.equal(0);
        expect(session.created).to.be.false;
    });
}); 