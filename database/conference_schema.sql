-- 会议信息表
Drop TABLE IF EXISTS jicofo_conference;
CREATE TABLE jicofo_conference (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_name VARCHAR(255) NOT NULL UNIQUE COMMENT '房间名称',
    meeting_id VARCHAR(255) COMMENT '会议ID',
    started BOOLEAN DEFAULT FALSE COMMENT '是否已开始',
    ended_at TIMESTAMP NULL COMMENT '结束时间',
    include_in_statistics BOOLEAN DEFAULT TRUE COMMENT '是否包含在统计中',
    jvb_version VARCHAR(50) COMMENT 'JVB版本',
    participant_count INT DEFAULT 0 COMMENT '参会人数',
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
    INDEX idx_room_name (room_name),
    INDEX idx_meeting_id (meeting_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会议信息表';

-- 参会人员表
Drop TABLE IF EXISTS jicofo_conference_participant;
CREATE TABLE jicofo_conference_participant (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL COMMENT '用户ID',
    room_name VARCHAR(255) NOT NULL COMMENT '房间名称',
    meeting_id VARCHAR(255) COMMENT '会议ID',
    role VARCHAR(50) NOT NULL COMMENT '角色(MODERATOR/PARTICIPANT/VISITOR)',
    audio_muted BOOLEAN DEFAULT TRUE COMMENT '音频是否静音',
    video_muted BOOLEAN DEFAULT TRUE COMMENT '视频是否静音',
    features TEXT COMMENT '支持的功能列表',
    joined_at TIMESTAMP NOT NULL COMMENT '加入时间',
    left_at TIMESTAMP NULL COMMENT '离开时间',
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
    INDEX idx_user_id (user_id),
    INDEX idx_room_name (room_name),
    INDEX idx_meeting_id (meeting_id),
    INDEX idx_joined_at (joined_at),
    FOREIGN KEY (room_name) REFERENCES jicofo_conference(room_name) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='参会人员表';

-- 操作日志记录
Drop TABLE IF EXISTS  jicofo_user_operation ;
CREATE TABLE jicofo_user_operation (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL COMMENT '用户ID',
    room_id VARCHAR(255) NOT NULL COMMENT '房间ID',
		meeting_id VARCHAR(255) COMMENT '会议ID',
    operation_type VARCHAR(50) NOT NULL COMMENT '操作类型',
    operation_data JSON COMMENT '操作详细数据',
	create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
	update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
    INDEX idx_user_id (user_id),
    INDEX idx_room_id (room_id),
    INDEX idx_operation_type (operation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户操作记录表';
