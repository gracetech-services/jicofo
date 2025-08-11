package org.jitsi.jicofo.storage;


import java.time.LocalDateTime;

/**
 * 会议信息数据模型
 */
public class ConferenceInfo {
    private Long id;
    private String roomName;
    private String meetingId;
    private boolean started;
    private LocalDateTime endedAt;
    private boolean includeInStatistics;
    private String jvbVersion;
    private int participantCount;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
    
    public ConferenceInfo() {}
    
    public ConferenceInfo(String roomName, String meetingId,
                         boolean started, boolean includeInStatistics) {
        this.roomName = roomName;
        this.meetingId = meetingId;
        this.started = started;
        this.includeInStatistics = includeInStatistics;

    }
    
    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    
    public String getRoomName() { return roomName; }
    public void setRoomName(String roomName) { this.roomName = roomName; }
    
    public String getMeetingId() { return meetingId; }
    public void setMeetingId(String meetingId) { this.meetingId = meetingId; }


    public boolean isStarted() { return started; }
    public void setStarted(boolean started) { this.started = started; }

    
    public boolean isIncludeInStatistics() { return includeInStatistics; }
    public void setIncludeInStatistics(boolean includeInStatistics) { this.includeInStatistics = includeInStatistics; }
    
    public String getJvbVersion() { return jvbVersion; }
    public void setJvbVersion(String jvbVersion) { this.jvbVersion = jvbVersion; }
    
    public int getParticipantCount() { return participantCount; }
    public void setParticipantCount(int participantCount) { this.participantCount = participantCount; }




    public LocalDateTime getEndedAt() {
        return endedAt;
    }

    public void setEndedAt(LocalDateTime endedAt) {
        this.endedAt = endedAt;
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }

    public LocalDateTime getUpdateTime() {
        return updateTime;
    }

    public void setUpdateTime(LocalDateTime updateTime) {
        this.updateTime = updateTime;
    }

}
