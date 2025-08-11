package org.jitsi.jicofo.storage;

import java.util.Set;
import java.sql.Timestamp;

/**
 * 参会人员信息数据模型
 */
public class ParticipantInfo {
    private Long id;
    private String userId;
    private String roomName;
    private String meetingId;
    private String role;
    private boolean audioMuted;
    private boolean videoMuted;
    private Set<String> features;
    private long joinedAt;
    private Long leftAt;
    
    public ParticipantInfo() {}
    
    public ParticipantInfo(String userId, String roomName, String meetingId, String role,
                          boolean audioMuted, boolean videoMuted, Set<String> features, long joinedAt) {
        this.userId = userId;
        this.roomName = roomName;
        this.meetingId = meetingId;
        this.role = role;
        this.audioMuted = audioMuted;
        this.videoMuted = videoMuted;
        this.features = features;
        this.joinedAt = joinedAt;
    }
    
    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    
    public String getRoomName() { return roomName; }
    public void setRoomName(String roomName) { this.roomName = roomName; }
    
    public String getMeetingId() { return meetingId; }
    public void setMeetingId(String meetingId) { this.meetingId = meetingId; }
    
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    
    public boolean isAudioMuted() { return audioMuted; }
    public void setAudioMuted(boolean audioMuted) { this.audioMuted = audioMuted; }
    
    public boolean isVideoMuted() { return videoMuted; }
    public void setVideoMuted(boolean videoMuted) { this.videoMuted = videoMuted; }
    
    public Set<String> getFeatures() { return features; }
    public void setFeatures(Set<String> features) { this.features = features; }
    
    public long getJoinedAt() { return joinedAt; }
    public void setJoinedAt(long joinedAt) { this.joinedAt = joinedAt; }
    
    public Long getLeftAt() { return leftAt; }
    public void setLeftAt(Long leftAt) { this.leftAt = leftAt; }
    
    // MyBatis需要的字符串转换方法
    public String getFeaturesStr() {
        return features != null ? String.join(",", features) : "";
    }
    
    public void setFeaturesStr(String featuresStr) {
        if (featuresStr != null && !featuresStr.isEmpty()) {
            this.features = Set.of(featuresStr.split(","));
        }
    }
    
    public Timestamp getJoinedAtTimestamp() {
        return new Timestamp(joinedAt);
    }
    
    public Timestamp getLeftAtTimestamp() {
        return leftAt != null ? new Timestamp(leftAt) : null;
    }
}
