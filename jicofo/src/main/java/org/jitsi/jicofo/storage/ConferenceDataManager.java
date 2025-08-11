package org.jitsi.jicofo.storage;

import org.jitsi.jicofo.conference.JitsiMeetConferenceImpl;
import org.jitsi.jicofo.conference.Participant;
import org.jitsi.jicofo.db.DatabaseManager;
import org.jitsi.utils.logging2.Logger;
import org.jitsi.utils.logging2.LoggerImpl;

import java.sql.Timestamp;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 使用MyBatis管理会议和参会人员信息的存储
 */
public class ConferenceDataManager {
    
    private static final Logger logger = new LoggerImpl(ConferenceDataManager.class.getName());
    private static ConferenceDataManager instance;
    
//    // 内存缓存
//    private final Map<String, ConferenceInfo> conferences = new ConcurrentHashMap<>();
//    private final Map<String, List<ParticipantInfo>> conferenceParticipants = new ConcurrentHashMap<>();
    
    private ConferenceDataManager() {}
    
    public static synchronized ConferenceDataManager getInstance() {
        if (instance == null) {
            instance = new ConferenceDataManager();
        }
        return instance;
    }
    
    /**
     * 存储会议信息
     */
    public void storeConferenceInfo(JitsiMeetConferenceImpl conference) {
        String roomName = conference.getRoomName().toString();
        String meetingId = conference.getMeetingId();
        
        ConferenceInfo info = new ConferenceInfo(
            roomName,
            meetingId,
            conference.getCreatedInstant(),
            conference.isStarted(),
            conference.includeInStatistics(),
            conference.getJvbVersion()
        );
        
        conferences.put(roomName, info);
        
        // 使用MyBatis存储到数据库
        DatabaseManager.getInstance().executeConferenceOperation(mapper -> {
            int result = mapper.insertConference(info);
            logger.info("Stored conference info: room={}, meetingId={}, result={}", roomName, meetingId, result);
            return result;
        });
    }
    
    /**
     * 存储参会人员信息
     */
    public void storeParticipantInfo(String roomName, Participant participant) {
        String meetingId = conferences.get(roomName) != null ? 
            conferences.get(roomName).getMeetingId() : null;
            
        ParticipantInfo info = new ParticipantInfo(
            participant.getChatMember().getName(),
            roomName,
            meetingId,
            participant.getChatMember().getRole().toString(),
            participant.getChatMember().isAudioMuted(),
            participant.getChatMember().isVideoMuted(),
            participant.getSupportedFeatures().stream()
                .map(f -> f.toString())
                .collect(java.util.stream.Collectors.toSet()),
            System.currentTimeMillis()
        );
        
        conferenceParticipants.computeIfAbsent(roomName, k -> new ArrayList<>()).add(info);
        
        // 使用MyBatis存储到数据库
        DatabaseManager.getInstance().executeParticipantOperation(mapper -> {
            int result = mapper.insertParticipant(info);
            logger.info("Stored participant info: user={}, room={}, meetingId={}, result={}", 
                info.getUserId(), roomName, meetingId, result);
            return result;
        });
    }
    
    /**
     * 更新参会人员媒体状态
     */
    public void updateParticipantMediaStatus(String roomName, String userId, boolean audioMuted, boolean videoMuted) {
        DatabaseManager.getInstance().executeParticipantOperation(mapper -> {
            int result = mapper.updateParticipantMediaStatus(userId, roomName, audioMuted, videoMuted);
            logger.debug("Updated participant media status: user={}, room={}, audio={}, video={}, result={}", 
                userId, roomName, audioMuted, videoMuted, result);
            return result;
        });
    }
    
    /**
     * 获取会议信息
     */
    public ConferenceInfo getConferenceInfo(String roomName) {
        // 先从缓存获取
        ConferenceInfo cached = conferences.get(roomName);
        if (cached != null) {
            return cached;
        }
        
        // 从数据库获取
        return DatabaseManager.getInstance().executeConferenceOperation(mapper -> {
            ConferenceInfo info = mapper.selectByRoomName(roomName);
            if (info != null) {
                conferences.put(roomName, info);
            }
            return info;
        });
    }
    
    /**
     * 获取会议的所有参会人员
     */
    public List<ParticipantInfo> getConferenceParticipants(String roomName) {
        return DatabaseManager.getInstance().executeParticipantOperation(mapper -> 
            mapper.selectByRoomName(roomName)
        );
    }
    
    /**
     * 获取会议的当前在线参会人员
     */
    public List<ParticipantInfo> getActiveParticipants(String roomName) {
        return DatabaseManager.getInstance().executeParticipantOperation(mapper -> 
            mapper.selectActiveParticipants(roomName)
        );
    }
    
    /**
     * 移除参会人员
     */
    public void removeParticipant(String roomName, String userId) {
        List<ParticipantInfo> participants = conferenceParticipants.get(roomName);
        if (participants != null) {
            participants.removeIf(p -> p.getUserId().equals(userId));
        }
        
        // 更新数据库中的离开时间
        DatabaseManager.getInstance().executeParticipantOperation(mapper -> {
            int result = mapper.updateParticipantLeftTime(userId, roomName, new Timestamp(System.currentTimeMillis()));
            logger.info("Updated participant left time: user={}, room={}, result={}", userId, roomName, result);
            return result;
        });
    }
    
    /**
     * 移除会议
     */
    public void removeConference(String roomName) {
        ConferenceInfo info = conferences.remove(roomName);
        conferenceParticipants.remove(roomName);
        
        if (info != null) {
            // 使用事务更新会议结束时间和参会人员离开时间
            DatabaseManager.getInstance().executeTransaction((conferenceMapper, participantMapper) -> {
                Timestamp endTime = new Timestamp(System.currentTimeMillis());
                
                // 更新会议结束时间
                int participantCount = participantMapper.countParticipants(roomName);
                int conferenceResult = conferenceMapper.updateConferenceEndTime(roomName, endTime, participantCount);
                
                // 更新所有未离开的参会人员的离开时间
                List<ParticipantInfo> activeParticipants = participantMapper.selectActiveParticipants(roomName);
                for (ParticipantInfo participant : activeParticipants) {
                    participantMapper.updateParticipantLeftTime(participant.getUserId(), roomName, endTime);
                }
                
                logger.info("Removed conference: room={}, participantCount={}, result={}", 
                    roomName, participantCount, conferenceResult);
                return conferenceResult;
            });
        }
    }
    
    /**
     * 获取所有活跃会议
     */
    public List<ConferenceInfo> getActiveConferences() {
        return DatabaseManager.getInstance().executeConferenceOperation(mapper -> 
            mapper.selectActiveConferences()
        );
    }
    
    /**
     * 统计会议数量
     */
    public int countConferences(java.time.Instant startTime, java.time.Instant endTime) {
        return DatabaseManager.getInstance().executeConferenceOperation(mapper -> 
            mapper.countConferences(Timestamp.from(startTime), Timestamp.from(endTime))
        );
    }
    
    /**
     * 批量存储参会人员信息
     */
    public void batchStoreParticipants(List<ParticipantInfo> participants) {
        DatabaseManager.getInstance().executeParticipantOperation(mapper -> {
            // 如果Mapper中有批量插入方法
            // return mapper.batchInsertParticipants(participants);
            
            // 否则逐个插入
            int totalResult = 0;
            for (ParticipantInfo participant : participants) {
                totalResult += mapper.insertParticipant(participant);
            }
            logger.info("Batch stored {} participants, total result: {}", participants.size(), totalResult);
            return totalResult;
        });
    }
}
