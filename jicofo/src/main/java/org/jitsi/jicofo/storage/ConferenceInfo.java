package org.jitsi.jicofo.storage;

import java.time.Instant;
import java.sql.Timestamp;

/**
 * 会议信息数据模型
 */
public class ConferenceInfo {
    private Long id;
    private String roomName;
    private String meetingId;
    private Instant createdAt;
    private boolean started;
    private Instant endedAt;
    private boolean includeInStatistics;
    private String jvbVersion;
    private int participantCount;
    
    public ConferenceInfo() {}
    
    public ConferenceInfo(String roomName, String meetingId, Instant createdAt, 
                         boolean started, boolean includeInStatistics, String jvbVersion) {
        this.roomName = roomName;
        this.meetingId = meetingId;
        this.createdAt = createdAt;
        this.started = started;
        this.includeInStatistics = includeInStatistics;
        this.jvbVersion = jvbVersion;
    }
    
    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    
    public String getRoomName() { return roomName; }
    public void setRoomName(String roomName) { this.roomName = roomName; }
    
    public String getMeetingId() { return meetingId; }
    public void setMeetingId(String meetingId) { this.meetingId = meetingId; }
    
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    
    public boolean isStarted() { return started; }
    public void setStarted(boolean started) { this.started = started; }
    
    public Instant getEndedAt() { return endedAt; }
    public void setEndedAt(Instant endedAt) { this.endedAt = endedAt; }
    
    public boolean isIncludeInStatistics() { return includeInStatistics; }
    public void setIncludeInStatistics(boolean includeInStatistics) { this.includeInStatistics = includeInStatistics; }
    
    public String getJvbVersion() { return jvbVersion; }
    public void setJvbVersion(String jvbVersion) { this.jvbVersion = jvbVersion; }
    
    public int getParticipantCount() { return participantCount; }
    public void setParticipantCount(int participantCount) { this.participantCount = participantCount; }
    
    // MyBatis需要的Timestamp转换方法
    public Timestamp getCreatedAtTimestamp() {
        return createdAt != null ? Timestamp.from(createdAt) : null;
    }
    
    public Timestamp getEndedAtTimestamp() {
        return endedAt != null ? Timestamp.from(endedAt) : null;
    }
}
