const EventEmitter = require('events');
const logger = require('../../utils/logger');

/**
 * Manages roles in MUC rooms based on authentication status.
 * Similar to the Java AuthenticationRoleManager.
 */
class RoleManager extends EventEmitter {
    constructor(chatRoom, authenticationAuthority) {
        super();
        this.chatRoom = chatRoom;
        this.authenticationAuthority = authenticationAuthority;
        this.logger = logger.child({ component: 'RoleManager', room: chatRoom.getRoomJid() });
        
        // Listen for member joins to automatically grant roles
        this.chatRoom.on('memberJoined', this.handleMemberJoined.bind(this));
        this.chatRoom.on('memberRoleChanged', this.handleMemberRoleChanged.bind(this));
        
        this.logger.info('RoleManager initialized');
    }

    /**
     * Handle when a new member joins the room
     */
    handleMemberJoined(member, presenceStanza) {
        this.logger.debug(`Member joined: ${member.getName()}`);
        
        // Check if the member is authenticated and grant ownership if needed
        if (this.authenticationAuthority) {
            this.grantOwnerToAuthenticatedUsers();
        }
    }

    /**
     * Handle when a member's role changes
     */
    handleMemberRoleChanged(member, newRole) {
        this.logger.debug(`Member role changed: ${member.getName()} -> ${newRole}`);
        
        // If the local user (focus) lost owner rights, we can't manage roles anymore
        const localMember = this.chatRoom.getChatMember(this.chatRoom.focusMucJid);
        if (localMember && !this.chatRoom.hasOwnerRights(localMember)) {
            this.logger.error('Local role has no owner rights, cannot manage roles.');
            return;
        }
        
        // Re-grant ownership to authenticated users if needed
        if (this.authenticationAuthority) {
            this.grantOwnerToAuthenticatedUsers();
        }
    }

    /**
     * Grant ownership to all authenticated users who don't already have owner rights
     */
    async grantOwnerToAuthenticatedUsers() {
        if (!this.authenticationAuthority) {
            this.logger.debug('No authentication authority configured');
            return;
        }

        const members = this.chatRoom.getMembers();
        for (const member of members) {
            // Skip members who already have owner rights
            if (this.chatRoom.hasOwnerRights(member)) {
                continue;
            }

            // Check if the member is authenticated
            const session = this.authenticationAuthority.getSessionForJid(member.mucJid);
            if (session) {
                this.logger.info(`Granting ownership to authenticated user: ${member.getName()}`);
                try {
                    const success = await this.chatRoom.grantOwnership(member);
                    if (success) {
                        this.emit('ownershipGranted', member);
                    }
                } catch (error) {
                    this.logger.error(`Failed to grant ownership to ${member.getName()}:`, error);
                }
            }
        }
    }

    /**
     * Grant ownership to a specific member
     */
    async grantOwnership(member) {
        if (!this.chatRoom.hasOwnerRights(this.chatRoom.getChatMember(this.chatRoom.focusMucJid))) {
            this.logger.error('Cannot grant ownership, local user has no owner rights');
            return false;
        }

        try {
            const success = await this.chatRoom.grantOwnership(member);
            if (success) {
                this.emit('ownershipGranted', member);
            }
            return success;
        } catch (error) {
            this.logger.error(`Failed to grant ownership to ${member.getName()}:`, error);
            return false;
        }
    }

    /**
     * Grant moderator role to a specific member
     */
    async grantModerator(member) {
        if (!this.chatRoom.hasModeratorRights(this.chatRoom.getChatMember(this.chatRoom.focusMucJid))) {
            this.logger.error('Cannot grant moderator, local user has no moderator rights');
            return false;
        }

        try {
            const success = await this.chatRoom.grantModerator(member);
            if (success) {
                this.emit('moderatorGranted', member);
            }
            return success;
        } catch (error) {
            this.logger.error(`Failed to grant moderator to ${member.getName()}:`, error);
            return false;
        }
    }

    /**
     * Revoke moderator role from a specific member
     */
    async revokeModerator(member) {
        if (!this.chatRoom.hasModeratorRights(this.chatRoom.getChatMember(this.chatRoom.focusMucJid))) {
            this.logger.error('Cannot revoke moderator, local user has no moderator rights');
            return false;
        }

        try {
            const success = await this.chatRoom.revokeModerator(member);
            if (success) {
                this.emit('moderatorRevoked', member);
            }
            return success;
        } catch (error) {
            this.logger.error(`Failed to revoke moderator from ${member.getName()}:`, error);
            return false;
        }
    }

    /**
     * Kick a member from the room
     */
    async kickMember(member, reason = '') {
        if (!this.chatRoom.hasModeratorRights(this.chatRoom.getChatMember(this.chatRoom.focusMucJid))) {
            this.logger.error('Cannot kick member, local user has no moderator rights');
            return false;
        }

        try {
            const success = await this.chatRoom.kickMember(member, reason);
            if (success) {
                this.emit('memberKicked', member, reason);
            }
            return success;
        } catch (error) {
            this.logger.error(`Failed to kick ${member.getName()}:`, error);
            return false;
        }
    }

    /**
     * Get debug state information
     */
    getDebugState() {
        return {
            class: this.constructor.name,
            roomJid: this.chatRoom.getRoomJid(),
            hasAuthenticationAuthority: !!this.authenticationAuthority,
            memberCount: this.chatRoom.getMemberCount(),
            moderators: this.chatRoom.getModerators().map(m => m.getName()),
            owners: this.chatRoom.getOwners().map(m => m.getName())
        };
    }

    /**
     * Stop the role manager and clean up listeners
     */
    stop() {
        this.chatRoom.removeListener('memberJoined', this.handleMemberJoined);
        this.chatRoom.removeListener('memberRoleChanged', this.handleMemberRoleChanged);
        this.logger.info('RoleManager stopped');
    }
}

module.exports = { RoleManager }; 