@echo off
chcp 65001 >nul
setlocal
rem Second Brain: makes the single "Second Brain.exe" (SPEC F29) with the Node.js installed on
rem this computer and puts it next to the app folder. Double-click it. The window stays open at
rem the end so the messages can be read. No parentheses in echo lines inside ( ) blocks.
set "APP_DIR=%~dp0.."
for %%I in ("%~dp0..\..") do set "HOME_DIR=%%~fI"
set "EXE_NAME=Second Brain.exe"
echo.
echo   Đang tạo bản exe của Second Brain, mất vài phút...
where node >nul 2>nul
if errorlevel 1 (
  echo   Chưa tìm thấy Node.js trên máy. Cài Node.js 24 LTS tại https://nodejs.org rồi bấm đúp lại tệp này.
  goto failed
)
pushd "%APP_DIR%"
if not exist "node_modules\.package-lock.json" (
  echo   Đang cài thư viện cho app, lần đầu mất vài phút...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    popd
    goto failed
  )
)
call npm run build:exe
if errorlevel 1 (
  popd
  goto failed
)
popd
copy /y "%APP_DIR%\dist-exe\%EXE_NAME%" "%HOME_DIR%\%EXE_NAME%" >nul
if errorlevel 1 (
  echo   Chưa chép được tệp exe. Nếu Second Brain đang chạy bằng exe, thoát nó trong khay rồi bấm đúp lại.
  goto failed
)
echo.
echo   Xong: "%HOME_DIR%\%EXE_NAME%"
echo   Bấm đúp tệp đó để mở app. Lần đầu mở, Windows có thể báo "Windows đã bảo vệ PC của bạn".
echo   Bấm "Thông tin bổ sung" rồi "Vẫn chạy" (tệp chưa được ký số).
echo.
pause
exit /b 0

:failed
echo.
echo   Chưa tạo được bản exe. Xem các dòng ở trên để biết vì sao, sửa rồi bấm đúp lại.
pause
exit /b 1
