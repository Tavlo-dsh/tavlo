//! 启动 / 结束 `dsh web` 子进程。
//!
//! Windows：子进程放进 Job Object（KILL_ON_JOB_CLOSE）。壳正常退出、崩溃或被任务管理器结束时，
//! 句柄关闭，整棵进程树（dsh 及其派生的 node / shell）都会被系统结束，不留孤儿进程。

use crate::dsh_locate::DshLauncher;
use std::io;
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// `dsh web` 的参数：不打开系统浏览器，由系统分配空闲端口。
pub fn web_args() -> Vec<&'static str> {
    vec!["web", "--no-open", "--port", "0"]
}

fn base_command(launcher: &DshLauncher, cwd: &Path) -> Command {
    let mut command = Command::new(&launcher.program);
    command.args(&launcher.prefix_args).current_dir(cwd).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// 运行 `dsh --version`，带超时。
pub fn query_version(launcher: &DshLauncher, cwd: &Path, timeout: Duration) -> io::Result<String> {
    let mut child = base_command(launcher, cwd)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let deadline = Instant::now() + timeout;
    loop {
        if child.try_wait()?.is_some() {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::new(io::ErrorKind::TimedOut, "dsh --version 超时"));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let output = child.wait_with_output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(io::Error::other(format!("dsh --version 失败（{}）：{}", output.status, stderr.trim())))
    }
}

pub struct DshProcess {
    child: Child,
    #[cfg(windows)]
    job: Option<job::Job>,
}

impl DshProcess {
    pub fn spawn(launcher: &DshLauncher, cwd: &Path) -> io::Result<Self> {
        let child = base_command(launcher, cwd)
            .args(web_args())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        #[cfg(windows)]
        let job = match job::Job::kill_on_close() {
            Ok(job) => match job.assign(&child) {
                Ok(()) => Some(job),
                Err(error) => {
                    eprintln!("tavlo: AssignProcessToJobObject failed: {error}");
                    None
                }
            },
            Err(error) => {
                eprintln!("tavlo: CreateJobObject failed: {error}");
                None
            }
        };
        Ok(Self {
            child,
            #[cfg(windows)]
            job,
        })
    }

    pub fn take_stdout(&mut self) -> Option<std::process::ChildStdout> {
        self.child.stdout.take()
    }

    pub fn take_stderr(&mut self) -> Option<std::process::ChildStderr> {
        self.child.stderr.take()
    }

    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }

    /// 结束整棵进程树。
    pub fn kill(&mut self) {
        #[cfg(windows)]
        if let Some(job) = self.job.take() {
            job.terminate();
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for DshProcess {
    fn drop(&mut self) {
        self.kill();
    }
}

#[cfg(windows)]
mod job {
    use std::io;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct Job(HANDLE);

    // 内核句柄可以跨线程使用。
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn kill_on_close() -> io::Result<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let job = Job(handle);
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(job)
            }
        }

        pub fn assign(&self, child: &Child) -> io::Result<()> {
            let ok = unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as HANDLE) };
            if ok == 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(())
            }
        }

        pub fn terminate(self) {
            unsafe {
                TerminateJobObject(self.0, 1);
            }
            // Drop 关闭句柄。
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_args_disable_browser_and_use_os_port() {
        assert_eq!(web_args(), vec!["web", "--no-open", "--port", "0"]);
    }

    #[cfg(windows)]
    #[test]
    fn kill_ends_process_tree() {
        // cmd 再派生一个长时间运行的 ping，结束 job 后两者都应退出。
        let launcher = DshLauncher {
            program: "cmd.exe".into(),
            prefix_args: vec!["/c".into(), "ping -n 30 127.0.0.1 >NUL & rem".into()],
            found_at: "cmd.exe".into(),
        };
        let mut process = DshProcess::spawn(&launcher, &std::env::temp_dir()).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert!(process.try_wait().unwrap().is_none());
        process.kill();
        assert!(process.try_wait().unwrap().is_some());
    }
}
