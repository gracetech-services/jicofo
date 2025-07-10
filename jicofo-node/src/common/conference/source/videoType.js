// Mirrors org.jitsi.jicofo.conference.source.VideoType

const VideoType = Object.freeze({
    CAMERA: "camera",
    DESKTOP: "desktop",
    NONE: "none" // Added for cases where videoType might not be applicable or set
});

function parseVideoType(str) {
    if (!str) return VideoType.NONE;
    const s = str.toLowerCase();
    if (s === VideoType.CAMERA) return VideoType.CAMERA;
    if (s === VideoType.DESKTOP) return VideoType.DESKTOP;
    return VideoType.NONE; // Or throw error, or return null depending on strictness
}

module.exports = {
    VideoType,
    parseVideoType
};
