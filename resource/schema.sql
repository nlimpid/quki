CREATE TABLE `user` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varbinary(64) NOT NULL,
  `user_name` varchar(64)  NOT NULL,
  `password_hash` varchar(128) DEFAULT NULL,
  `created` timestamp NOT NULL,
  `updated` timestamp unsigned NOT NULL,
  `is_admin` tinyint(1) NOT NULL,
  `is_email_verified` int(10) unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_name` (`user_name`),
  UNIQUE KEY `quki_id` (`quki_id`),
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4


CREATE TABLE `session` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varbinary(64) NOT NULL,
  `type` varchar(32) NOT NULL,
  `session_key` varchar(64)  NOT NULL,
  `session_start` timestamp unsigned NOT NULL,
  `session_expires` timestamp unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_key` (`session_key`),
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4


create table `question` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `user_id` varbinary(64) NOT NULL,
    `question_id` varbinary(64) NOT NULL,
    `title` varchar(64)  NOT NULL,
    `topic`
    `content` text,

)


