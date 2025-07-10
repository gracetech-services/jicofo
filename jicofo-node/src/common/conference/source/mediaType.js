// Mirrors org.jitsi.utils.MediaType

const MediaType = Object.freeze({
    AUDIO: 'audio',
    VIDEO: 'video',
    DATA: 'data', // Less common in Jicofo sources, but part of the enum
    TEXT: 'text', // For T.140, not typically in Jingle sources for WebRTC
    APPLICATION: 'application',
    IMAGE: 'image',
    MESSAGE: 'message',
    CONTROL: 'control', // For things like RTCP feedback
    OTHER: 'other'
});

module.exports = MediaType;
